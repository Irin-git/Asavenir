<?php
// Clé secrète protégeant l'endpoint de rappels automatiques (api/cron/rappels_epreuves.php).
// Ce endpoint est appelé sans JWT par une tâche planifiée externe (GitHub Actions),
// donc on utilise cette clé en paramètre GET pour empêcher n'importe qui de le déclencher.
// Remplace par une chaîne longue et aléatoire, puis reporte la MÊME valeur dans le secret
// GitHub "CRON_SECRET_KEY" (voir .github/workflows/rappels_epreuves.yml).
return [
    'secret' => '00aff967f77cb86dc0a54a04d04509766aa901095a7ec182a9e758ae1c5feacf',
];
