<?php
// Clé secrète protégeant l'endpoint de rappels automatiques (api/cron/rappels_epreuves.php).
// Ce endpoint est appelé sans JWT par une tâche planifiée externe (GitHub Actions),
// donc on utilise cette clé en paramètre GET pour empêcher n'importe qui de le déclencher.
// Remplace par une chaîne longue et aléatoire, puis reporte la MÊME valeur dans le secret
// GitHub "CRON_SECRET_KEY" (voir .github/workflows/rappels_epreuves.yml).
return [
    'secret' => 'REMPLACER_PAR_UNE_CLE_SECRETE_LONGUE_ET_ALEATOIRE',
];
