<?php
/**
 * Plugin Name: Ship Check Connector
 * Description: Read-only inventory synchronisation with Ship Check Cloud.
 * Version: 0.1.0
 * Requires PHP: 7.4
 */
if (!defined('ABSPATH')) { exit; }

const SHIP_CHECK_OPTION = 'ship_check_connector_token';
const SHIP_CHECK_API = 'https://cloud-check.good-ship.co.uk';
const SHIP_CHECK_CRON = 'ship_check_connector_sync';

add_action('admin_menu', function () {
    add_management_page('Ship Check', 'Ship Check', 'manage_options', 'ship-check', 'ship_check_admin_page');
});
add_action('admin_post_ship_check_pair', 'ship_check_pair');
add_action('admin_post_ship_check_disconnect', 'ship_check_disconnect');
add_action('admin_post_ship_check_sync', 'ship_check_sync_now');
add_action(SHIP_CHECK_CRON, 'ship_check_sync');
add_action('upgrader_process_complete', function () {
    wp_schedule_single_event(time() + 60, SHIP_CHECK_CRON);
}, 10, 0);
add_action('activated_plugin', function () {
    wp_schedule_single_event(time() + 60, SHIP_CHECK_CRON);
});
add_action('deactivated_plugin', function () {
    wp_schedule_single_event(time() + 60, SHIP_CHECK_CRON);
});
register_activation_hook(__FILE__, function () {
    if (!wp_next_scheduled(SHIP_CHECK_CRON)) wp_schedule_event(time() + 300, 'daily', SHIP_CHECK_CRON);
});
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook(SHIP_CHECK_CRON);
});

function ship_check_admin_page() {
    if (!current_user_can('manage_options')) wp_die('Access denied.');
    $connected = (bool)get_option(SHIP_CHECK_OPTION);
    echo '<div class="wrap"><h1>Ship Check Connector</h1><p>Send only installed component names, versions and active status. No user data, passwords or source code.</p>';
    if (isset($_GET['ship_check_result'])) {
        $result = sanitize_key(wp_unslash($_GET['ship_check_result']));
        echo '<div class="notice notice-info"><p>' . esc_html($result === 'connected' ? 'Connected. First inventory sync requested.' : ($result === 'disconnected' ? 'Disconnected locally. Revoke the connector in Cloud as well.' : ($result === 'synced' ? 'Inventory synchronised.' : 'Connection or sync failed. Check your connection and try again.'))) . '</p></div>';
    }
    if ($connected) {
        echo '<p><strong>Connected to Ship Check Cloud</strong></p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('ship_check_disconnect');
        echo '<input type="hidden" name="action" value="ship_check_disconnect"><button class="button">Disconnect this site</button></form>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('ship_check_sync');
        echo '<input type="hidden" name="action" value="ship_check_sync"><button class="button button-primary">Sync now</button></form>';
        $last = get_option('ship_check_connector_last_success');
        if (is_numeric($last)) echo '<p>Last successful sync: ' . esc_html(wp_date('j M Y H:i', (int) $last)) . '</p>';
    } else {
        echo '<p>In Ship Check Cloud, open your project and select Connect WordPress. Copy the pairing code into this form.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('ship_check_pair');
        echo '<input type="hidden" name="action" value="ship_check_pair">';
        echo '<label for="ship-check-code">Pairing code</label> <input id="ship-check-code" name="pairing_code" type="password" size="78" required autocomplete="off">';
        echo ' <button class="button button-primary">Connect</button></form>';
    }
    echo '</div>';
}
function ship_check_pair() {
    if (!current_user_can('manage_options')) wp_die('Access denied.');
    check_admin_referer('ship_check_pair');
    $code = isset($_POST['pairing_code']) ? sanitize_text_field(wp_unslash($_POST['pairing_code'])) : '';
    if (!preg_match('/^sc_pair_[a-f0-9]{64}$/D', $code)) ship_check_redirect('failed');
    $response = wp_remote_post(SHIP_CHECK_API . '/api/cms/connect', [
        'timeout' => 15, 'redirection' => 0,
        'headers' => ['Authorization' => 'Bearer ' . $code, 'Content-Type' => 'application/json'],
        'body' => wp_json_encode(['cms' => 'wordpress'])
    ]);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) ship_check_redirect('failed');
    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body) || !isset($body['connectorToken']) ||
        !preg_match('/^sc_site_[a-f0-9]{64}$/D', $body['connectorToken'])) ship_check_redirect('failed');
    update_option(SHIP_CHECK_OPTION, $body['connectorToken'], false);
    wp_schedule_single_event(time() + 10, SHIP_CHECK_CRON);
    ship_check_redirect('connected');
}
function ship_check_sync_now() {
    if (!current_user_can('manage_options')) wp_die('Access denied.');
    check_admin_referer('ship_check_sync');
    ship_check_redirect(ship_check_sync() ? 'synced' : 'failed');
}
function ship_check_disconnect() {
    if (!current_user_can('manage_options')) wp_die('Access denied.');
    check_admin_referer('ship_check_disconnect');
    delete_option(SHIP_CHECK_OPTION);
    delete_option('ship_check_connector_last_success');
    wp_clear_scheduled_hook(SHIP_CHECK_CRON);
    ship_check_redirect('disconnected');
}
function ship_check_redirect($result) {
    wp_safe_redirect(add_query_arg('ship_check_result', $result, admin_url('tools.php?page=ship-check')));
    exit;
}
function ship_check_inventory() {
    if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $items = [['kind'=>'wordpress-core','id'=>'wordpress','version'=>get_bloginfo('version'),'active'=>true]];
    foreach (get_plugins() as $path => $data) {
        $slug = dirname($path);
        if ($slug === '.') $slug = basename($path, '.php');
        if (!preg_match('/^[A-Za-z0-9._-]{1,160}$/D', $slug)) continue;
        $item = ['kind'=>'wordpress-plugin','id'=>$slug,'active'=>is_plugin_active($path)];
        if (isset($data['Version']) && is_string($data['Version']) && preg_match('/^[A-Za-z0-9._+\\/-]{1,80}$/D', $data['Version'])) $item['version'] = $data['Version'];
        $items[] = $item;
    }
    foreach (wp_get_themes() as $slug => $theme) {
        if (!preg_match('/^[A-Za-z0-9._-]{1,160}$/D', $slug)) continue;
        $item = ['kind'=>'wordpress-theme','id'=>$slug,'active'=>($slug === get_stylesheet() || $slug === get_template())];
        $version = $theme->get('Version');
        if (is_string($version) && preg_match('/^[A-Za-z0-9._+\\/-]{1,80}$/D', $version)) $item['version'] = $version;
        $items[] = $item;
    }
    return $items;
}
function ship_check_sync() {
    $token = get_option(SHIP_CHECK_OPTION);
    if (!is_string($token) || !preg_match('/^sc_site_[a-f0-9]{64}$/D', $token)) return false;
    $components = ship_check_inventory();
    if (count($components) > 500) return false;
    $response = wp_remote_request(SHIP_CHECK_API . '/api/cms/inventory', [
        'method'=>'PUT','timeout'=>15,'redirection'=>0,
        'headers'=>['Authorization'=>'Bearer '.$token,'Content-Type'=>'application/json'],
        'body'=>wp_json_encode(['cms'=>'wordpress','components'=>$components])
    ]);
    $success = !is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200;
    if ($success) update_option('ship_check_connector_last_success', time(), false);
    return $success;
}
