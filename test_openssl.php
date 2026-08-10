<?php
// Force le chemin OpenSSL directement depuis PHP, car la variable
// d'environnement système n'est pas lue par le processus Apache/WAMP.
putenv('OPENSSL_CONF=C:\\wamp64\\bin\\php\\php8.3.14\\extras\\ssl\\openssl.cnf');

require_once __DIR__ . '/vendor/autoload.php';

$keys = \Minishlink\WebPush\VAPID::createVapidKeys();
echo "PUBLIC: " . $keys['publicKey'] . "\n";
echo "PRIVATE: " . $keys['privateKey'] . "\n";