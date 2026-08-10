<?php
require_once __DIR__ . '/vendor/autoload.php';

$keys = \Minishlink\WebPush\VAPID::createVapidKeys();
echo "PUBLIC: " . $keys['publicKey'] . "\n";
echo "PRIVATE: " . $keys['privateKey'] . "\n";