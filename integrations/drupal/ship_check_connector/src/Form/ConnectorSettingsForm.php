<?php

namespace Drupal\ship_check_connector\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Administrator-only connection settings.
 */
final class ConnectorSettingsForm extends FormBase {

  public function getFormId(): string {
    return 'ship_check_connector_settings';
  }

  public function buildForm(array $form, FormStateInterface $form_state): array {
    $connected = (bool) \Drupal::state()->get('ship_check_connector.token');
    $form['intro'] = [
      '#markup' => '<p>Share installed Drupal component identifiers and versions only. No content, accounts or credentials are uploaded.</p>',
    ];
    if ($connected) {
      $form['status'] = ['#markup' => '<p><strong>Connected to Ship Check Cloud.</strong></p>'];
      $form['actions']['sync'] = ['#type' => 'submit', '#value' => $this->t('Sync now'), '#submit' => ['::syncNow']];
      $form['actions']['disconnect'] = ['#type' => 'submit', '#value' => $this->t('Disconnect'), '#submit' => ['::disconnect']];
    }
    else {
      $form['code'] = ['#type' => 'password', '#title' => $this->t('Pairing code'), '#required' => TRUE];
      $form['actions']['submit'] = ['#type' => 'submit', '#value' => $this->t('Connect')];
    }
    return $form;
  }

  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $code = (string) $form_state->getValue('code');
    $ok = \Drupal::service('ship_check_connector.sync')->pair($code);
    $this->messenger()->addMessage($ok ? $this->t('Connected. Run Sync now to send inventory.') : $this->t('Pairing failed or expired.'));
  }

  public function syncNow(array &$form, FormStateInterface $form_state): void {
    $ok = \Drupal::service('ship_check_connector.sync')->sync();
    $this->messenger()->addMessage($ok ? $this->t('Inventory synchronised.') : $this->t('Inventory sync failed.'));
  }

  public function disconnect(array &$form, FormStateInterface $form_state): void {
    \Drupal::service('ship_check_connector.sync')->disconnect();
    $this->messenger()->addMessage($this->t('Disconnected locally. Also revoke the connection in Ship Check Cloud.'));
  }
}
