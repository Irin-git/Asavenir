<?php
// Config Google OAuth — le Client ID n'est PAS un secret (il est visible côté navigateur),
// donc pas besoin de le gitignorer comme mailer.php.
// À récupérer sur https://console.cloud.google.com/apis/credentials
// (créer un "ID client OAuth" de type "Application Web", puis ajouter
// http://localhost et https://asavenir.infinityfree.io comme origines autorisées)
return [
    'client_id' => 'REMPLACER_PAR_VOTRE_CLIENT_ID.apps.googleusercontent.com',
];
