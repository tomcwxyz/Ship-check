<?php

namespace Drupal\ship_check_connector\Service;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Extension\ModuleExtensionList;
use Drupal\Core\Extension\ThemeExtensionList;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\Core\State\StateInterface;
use GuzzleHttp\ClientInterface;

/**
 * Sends installed extension versions to Ship Check, without site content.
 */
final class InventorySync {

  public function __construct(
    private readonly ClientInterface $client,
    private readonly ConfigFactoryInterface $configFactory,
    private readonly StateInterface $state,
    private readonly ModuleExtensionList $modules,
    private readonly ThemeExtensionList $themes,
    private readonly LoggerChannelFactoryInterface $loggerFactory,
  ) {}

  public function pair(string $code): bool {
    if (!preg_match('/^sc_pair_[a-f0-9]{64}$/D', $code)) {
      return FALSE;
    }
    try {
      $response = $this->client->request('POST', 'https://cloud-check.good-ship.co.uk/api/cms/connect', [
        'http_errors' => FALSE,
        'allow_redirects' => FALSE,
        'timeout' => 15,
        'headers' => ['Authorization' => 'Bearer ' . $code],
        'json' => ['cms' => 'drupal'],
      ]);
      if ($response->getStatusCode() !== 200) {
        return FALSE;
      }
      $body = json_decode((string) $response->getBody(), TRUE);
      if (!is_array($body) || !isset($body['connectorToken']) ||
          !preg_match('/^sc_site_[a-f0-9]{64}$/D', $body['connectorToken'])) {
        return FALSE;
      }
      $this->state->set('ship_check_connector.token', $body['connectorToken']);
      return TRUE;
    }
    catch (\Throwable $e) {
      $this->loggerFactory->get('ship_check_connector')->warning('Pairing request failed.');
      return FALSE;
    }
  }

  public function disconnect(): void {
    $this->state->delete('ship_check_connector.token');
  }

  public function inventory(): array {
    $items = [];
    $installed = $this->modules->getAllInstalledInfo();
    $core = \Drupal::VERSION;
    $items[] = ['kind' => 'drupal-package', 'id' => 'drupal/core', 'version' => $core, 'active' => TRUE];
    foreach ($installed as $name => $info) {
      if (!preg_match('/^[a-z0-9_]{1,120}$/D', $name)) {
        continue;
      }
      // Module machine names do not always equal Composer package names.
      // Only record explicitly declared package identifiers, never guess.
      $package = $info['project'] ?? NULL;
      $version = $info['version'] ?? NULL;
      if (!is_string($package) || !preg_match('/^[a-z0-9_-]{1,120}$/D', $package)) {
        continue;
      }
      $id = 'drupal/' . $package;
      $item = ['kind' => 'drupal-package', 'id' => $id, 'active' => TRUE];
      if (is_string($version) && preg_match('/^[A-Za-z0-9._+\\/-]{1,80}$/D', $version)) {
        $item['version'] = $version;
      }
      $items[] = $item;
    }
    // Deduplicate submodules belonging to the same contributed project.
    $unique = [];
    foreach ($items as $item) {
      $unique[$item['kind'] . ':' . $item['id']] = $item;
    }
    return array_values($unique);
  }

  public function sync(): bool {
    $token = $this->state->get('ship_check_connector.token');
    if (!is_string($token) || !preg_match('/^sc_site_[a-f0-9]{64}$/D', $token)) {
      return FALSE;
    }
    $items = $this->inventory();
    if (count($items) > 500) {
      return FALSE;
    }
    try {
      $response = $this->client->request('PUT', 'https://cloud-check.good-ship.co.uk/api/cms/inventory', [
        'http_errors' => FALSE,
        'allow_redirects' => FALSE,
        'timeout' => 15,
        'headers' => ['Authorization' => 'Bearer ' . $token],
        'json' => ['cms' => 'drupal', 'components' => $items],
      ]);
      $ok = $response->getStatusCode() === 200;
      if ($ok) {
        $this->state->set('ship_check_connector.last_success', \Drupal::time()->getRequestTime());
      }
      return $ok;
    }
    catch (\Throwable $e) {
      $this->loggerFactory->get('ship_check_connector')->warning('Inventory sync failed.');
      return FALSE;
    }
  }
}
