<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';
require_once __DIR__ . '/../utils/notifier.php';

// ⚠️ Fonction placée ici, au niveau racine du script (jamais imbriquée dans un autre bloc),
// pour pouvoir être appelée depuis n'importe où plus bas dans le fichier
function recalculerClassement($conn, $concours_id) {
    // Récupère le nombre de places disponibles pour ce concours
    $nbStmt = $conn->prepare("SELECT nb_places FROM concours WHERE id = ?");
    $nbStmt->execute([$concours_id]);
    $nb_places = $nbStmt->fetchColumn();

    // Récupère tous les résultats du concours, triés du meilleur au moins bon
    $listStmt = $conn->prepare("
        SELECT r.id, r.note_totale
        FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE c.concours_id = ?
        ORDER BY r.note_totale DESC
    ");
    $listStmt->execute([$concours_id]);
    $liste = $listStmt->fetchAll(PDO::FETCH_ASSOC);

    // On attribue un rang à chaque candidat et on déduit sa mention finale
    $rang = 1;
    foreach ($liste as $ligne) {
        // Ordre de priorité fixé par le cahier des charges :
        // être dans le nombre de places disponibles prime sur la simple moyenne
        if ($nb_places !== null && $rang <= $nb_places) {
            $mention = 'Admis';
        } elseif ($ligne['note_totale'] >= 10) {
            $mention = 'Ajourné';
        } else {
            $mention = 'Rejeté';
        }

        $upd = $conn->prepare("UPDATE resultats SET rang = ?, mention = ? WHERE id = ?");
        $upd->execute([$rang, $mention, $ligne['id']]);
        $rang++;
    }
}

// ⚠️ Vérifie qu'un jury est bien affecté à une épreuve précise
// avant de le laisser lire ou noter les copies de celle-ci.
function juryEstAffecteAEpreuve($conn, $jury_id, $epreuve_id) {
    $stmt = $conn->prepare("
        SELECT COUNT(*) FROM jury_affectations_epreuve
        WHERE jury_id = ? AND epreuve_id = ?
    ");
    $stmt->execute([$jury_id, $epreuve_id]);
    return $stmt->fetchColumn() > 0;
}

$method = $_SERVER['REQUEST_METHOD'];
$user = verifierToken();

// ===== GET a_corriger — liste des copies ouvertes à corriger, réservée au jury =====
if ($method === 'GET' && isset($_GET['a_corriger'])) {

    if ($user->role !== 'jury') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé au jury"]);
        exit();
    }

    $epreuve_id = $_GET['epreuve_id'] ?? null;

    if (!$epreuve_id) {
        http_response_code(400);
        echo json_encode(["message" => "epreuve_id requis"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Vérification du cloisonnement par épreuve : un jury ne peut consulter
    // que les copies des épreuves pour lesquelles il est explicitement affecté.
    if (!juryEstAffecteAEpreuve($conn, $user->id, $epreuve_id)) {
        http_response_code(403);
        echo json_encode(["message" => "Vous n'êtes pas affecté à cette épreuve"]);
        exit();
    }

    // On ne renvoie JAMAIS le nom du candidat ici -> c'est ce qui garantit l'anonymat de la correction
    $stmt = $conn->prepare("
        SELECT 
            r.id AS reponse_id,
            r.candidature_id,
            r.texte_reponse,
            q.enonce,
            q.points AS bareme
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        WHERE q.epreuve_id = ?
          AND q.type IN ('ouverte_courte', 'ouverte_longue', 'etude_de_cas')
          AND r.points_obtenus IS NULL
          AND r.texte_reponse IS NOT NULL
    ");
    $stmt->execute([$epreuve_id]);

    $reponses = $stmt->fetchAll(PDO::FETCH_ASSOC);

    http_response_code(200);
    echo json_encode($reponses);

// ===== GET stats_concours — statistiques globales d'un concours, réservé admin =====
} else if ($method === 'GET' && isset($_GET['stats_concours'])) {

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé à l'administrateur"]);
        exit();
    }

    $concours_id = $_GET['stats_concours'];

    $conn = (new Database())->connect();

    // Nombre total de candidatures validées pour ce concours
    $totalStmt = $conn->prepare("
        SELECT COUNT(*) FROM candidatures 
        WHERE concours_id = ? AND statut = 'validé'
    ");
    $totalStmt->execute([$concours_id]);
    $total_candidats = (int) $totalStmt->fetchColumn();

    // Répartition par mention (uniquement les candidats déjà notés)
    $mentionStmt = $conn->prepare("
        SELECT r.mention, COUNT(*) AS total
        FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE c.concours_id = ?
        GROUP BY r.mention
    ");
    $mentionStmt->execute([$concours_id]);
    $mentionsBrutes = $mentionStmt->fetchAll(PDO::FETCH_KEY_PAIR); // ['Admis' => 5, 'Rejeté' => 12, ...]

    $admis   = (int) ($mentionsBrutes['Admis'] ?? 0);
    $ajourne = (int) ($mentionsBrutes['Ajourné'] ?? 0);
    $rejete  = (int) ($mentionsBrutes['Rejeté'] ?? 0);
    $notes   = $admis + $ajourne + $rejete;

    $taux_reussite = $notes > 0 ? round(($admis / $notes) * 100, 1) : 0;

    echo json_encode([
        "total_candidats" => $total_candidats,
        "deja_notes"      => $notes,
        "en_attente"      => $total_candidats - $notes,
        "admis"           => $admis,
        "ajourne"         => $ajourne,
        "rejete"          => $rejete,
        "taux_reussite"   => $taux_reussite
    ]);

// ===== GET stats_globales — vue d'ensemble tous concours confondus, réservé admin (Chantier 5) =====
} else if ($method === 'GET' && isset($_GET['stats_globales'])) {

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé à l'administrateur"]);
        exit();
    }

    $conn = (new Database())->connect();

    $totalConcoursStmt = $conn->query("SELECT COUNT(*) FROM concours");
    $total_concours = (int) $totalConcoursStmt->fetchColumn();

    $concoursOuvertsStmt = $conn->query("SELECT COUNT(*) FROM concours WHERE statut = 'ouvert'");
    $concours_ouverts = (int) $concoursOuvertsStmt->fetchColumn();

    // Candidats uniques ayant postulé au moins une fois, tous concours confondus
    $totalCandidatsStmt = $conn->query("SELECT COUNT(DISTINCT user_id) FROM candidatures");
    $total_candidats = (int) $totalCandidatsStmt->fetchColumn();

    $totalCandidaturesStmt = $conn->query("SELECT COUNT(*) FROM candidatures");
    $total_candidatures = (int) $totalCandidaturesStmt->fetchColumn();

    // Répartition par mention, sur TOUS les résultats déjà saisis (même logique que stats_concours,
    // mais sans filtrer par concours_id)
    $mentionStmt = $conn->query("SELECT mention, COUNT(*) AS total FROM resultats GROUP BY mention");
    $mentionsBrutes = $mentionStmt->fetchAll(PDO::FETCH_KEY_PAIR);

    $admis   = (int) ($mentionsBrutes['Admis'] ?? 0);
    $ajourne = (int) ($mentionsBrutes['Ajourné'] ?? 0);
    $rejete  = (int) ($mentionsBrutes['Rejeté'] ?? 0);
    $notes   = $admis + $ajourne + $rejete;

    $taux_reussite_global = $notes > 0 ? round(($admis / $notes) * 100, 1) : 0;

    // Top 5 des concours les plus demandés — donne un aperçu utile sans surcharger le tableau de bord
    $topConcoursStmt = $conn->query("
        SELECT c.titre, COUNT(ca.id) AS total_candidatures
        FROM concours c
        LEFT JOIN candidatures ca ON ca.concours_id = c.id
        GROUP BY c.id
        ORDER BY total_candidatures DESC
        LIMIT 5
    ");
    $top_concours = $topConcoursStmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        "total_concours"        => $total_concours,
        "concours_ouverts"      => $concours_ouverts,
        "total_candidats"       => $total_candidats,
        "total_candidatures"    => $total_candidatures,
        "admis"                 => $admis,
        "ajourne"               => $ajourne,
        "rejete"                => $rejete,
        "taux_reussite_global"  => $taux_reussite_global,
        "top_concours"          => $top_concours
    ]);

// ===== GET par_candidat — classement détaillé d'un concours, réservé admin =====
// La réponse est enveloppée dans un objet { publie, candidats } pour que le front
// sache si ce classement est déjà visible par les candidats ou non.
} else if ($method === 'GET' && isset($_GET['par_candidat'])) {

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé à l'administrateur"]);
        exit();
    }

    $concours_id = $_GET['par_candidat'];

    $conn = (new Database())->connect();

    // On vérifie l'état de publication du concours au passage
    $pubStmt = $conn->prepare("SELECT resultats_publies FROM concours WHERE id = ?");
    $pubStmt->execute([$concours_id]);
    $publie = (bool) $pubStmt->fetchColumn();

    // 1. Liste des candidats notés pour ce concours, avec leur résultat global
    $candidatsStmt = $conn->prepare("
        SELECT 
            c.id AS candidature_id,
            u.nom,
            u.prenom,
            r.note_totale,
            r.mention,
            r.rang
        FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        INNER JOIN users u ON c.user_id = u.id
        WHERE c.concours_id = ?
        ORDER BY r.rang ASC
    ");
    $candidatsStmt->execute([$concours_id]);
    $candidats = $candidatsStmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Pour chaque candidat, détail des notes par épreuve (avec conversion sur 20)
    $detailStmt = $conn->prepare("
        SELECT 
            e.titre,
            e.coefficient,
            SUM(CASE 
                    WHEN r.points_obtenus IS NOT NULL THEN r.points_obtenus
                    WHEN r.est_correcte = 1 THEN q.points
                    ELSE 0
                END) AS obtenu,
            SUM(q.points) AS possible
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        INNER JOIN epreuves e ON q.epreuve_id = e.id
        WHERE r.candidature_id = ?
        GROUP BY e.id, e.titre, e.coefficient
    ");

    foreach ($candidats as &$candidat) {
        $detailStmt->execute([$candidat['candidature_id']]);
        $epreuvesDetail = $detailStmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($epreuvesDetail as &$ep) {
            $ep['note_sur_20'] = $ep['possible'] > 0
                ? round(($ep['obtenu'] / $ep['possible']) * 20, 2)
                : 0;
        }
        unset($ep);

        $candidat['epreuves'] = $epreuvesDetail;
    }
    unset($candidat);

    http_response_code(200);
    echo json_encode([
        "publie"    => $publie,
        "candidats" => $candidats
    ]);

// ===== GET detail_candidat — détail complet d'un candidat, réservé admin =====
} else if ($method === 'GET' && isset($_GET['detail_candidat'])) {

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé à l'administrateur"]);
        exit();
    }

    $candidature_id = $_GET['detail_candidat'];

    $conn = (new Database())->connect();

    // Infos du candidat + son résultat global
    $infoStmt = $conn->prepare("
        SELECT 
            u.nom, u.prenom, u.email,
            co.titre AS titre_concours,
            r.note_totale, r.mention, r.rang
        FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        INNER JOIN users u ON c.user_id = u.id
        INNER JOIN concours co ON c.concours_id = co.id
        WHERE r.candidature_id = ?
    ");
    $infoStmt->execute([$candidature_id]);
    $candidat = $infoStmt->fetch(PDO::FETCH_ASSOC);

    if (!$candidat) {
        http_response_code(404);
        echo json_encode(["message" => "Résultat introuvable"]);
        exit();
    }

    // Détail des notes par épreuve, converties sur 20
    $detailStmt = $conn->prepare("
        SELECT 
            e.titre,
            e.coefficient,
            SUM(CASE 
                    WHEN r.points_obtenus IS NOT NULL THEN r.points_obtenus
                    WHEN r.est_correcte = 1 THEN q.points
                    ELSE 0
                END) AS obtenu,
            SUM(q.points) AS possible
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        INNER JOIN epreuves e ON q.epreuve_id = e.id
        WHERE r.candidature_id = ?
        GROUP BY e.id, e.titre, e.coefficient
    ");
    $detailStmt->execute([$candidature_id]);
    $epreuves = $detailStmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($epreuves as &$ep) {
        $ep['note_sur_20'] = $ep['possible'] > 0
            ? round(($ep['obtenu'] / $ep['possible']) * 20, 2)
            : 0;
    }
    unset($ep);

    $candidat['epreuves'] = $epreuves;

    http_response_code(200);
    echo json_encode($candidat);

// ===== GET mes_resultats — résultats du candidat connecté, un par concours =====
// ⚠️ NOUVEAU — ownership strict : on part UNIQUEMENT de $user->id (issu du token JWT),
// jamais d'un ID transmis par le client. Un concours n'apparaît "disponible" que si
// l'admin a publié ses résultats ET que la note du candidat a bien été calculée.
} else if ($method === 'GET' && isset($_GET['mes_resultats'])) {

    if ($user->role !== 'candidat') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé aux candidats"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Toutes les candidatures validées de ce candidat, avec l'état de publication
    // du concours parent et son éventuel résultat (LEFT JOIN car pas encore corrigé = normal)
    $stmt = $conn->prepare("
        SELECT 
            c.id AS candidature_id,
            co.id AS concours_id,
            co.titre AS concours_titre,
            co.resultats_publies,
            r.note_totale,
            r.mention,
            r.rang
        FROM candidatures c
        INNER JOIN concours co ON c.concours_id = co.id
        LEFT JOIN resultats r ON r.candidature_id = c.id
        WHERE c.user_id = ? AND c.statut = 'validé'
        ORDER BY co.date_debut DESC
    ");
    $stmt->execute([$user->id]);
    $lignes = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Requête réutilisée pour chaque candidature dont le résultat est bien disponible
    $detailStmt = $conn->prepare("
        SELECT 
            e.titre,
            e.coefficient,
            SUM(CASE 
                    WHEN r.points_obtenus IS NOT NULL THEN r.points_obtenus
                    WHEN r.est_correcte = 1 THEN q.points
                    ELSE 0
                END) AS obtenu,
            SUM(q.points) AS possible
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        INNER JOIN epreuves e ON q.epreuve_id = e.id
        WHERE r.candidature_id = ?
        GROUP BY e.id, e.titre, e.coefficient
    ");

    $resultats = [];

    foreach ($lignes as $ligne) {
        $publie = (bool) $ligne['resultats_publies'];
        $noteDispo = $ligne['note_totale'] !== null;
        // Un résultat n'est "disponible" pour le candidat que si les DEUX conditions sont réunies
        $disponible = $publie && $noteDispo;

        $item = [
            "concours_id"         => $ligne['concours_id'],
            "concours_titre"      => $ligne['concours_titre'],
            "publie"              => $publie,
            "resultat_disponible" => $disponible,
            "note_totale"         => $disponible ? (float) $ligne['note_totale'] : null,
            "mention"             => $disponible ? $ligne['mention'] : null,
            "rang"                => $disponible ? (int) $ligne['rang'] : null,
            "epreuves"            => []
        ];

        if ($disponible) {
            $detailStmt->execute([$ligne['candidature_id']]);
            $epreuvesDetail = $detailStmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($epreuvesDetail as &$ep) {
                $ep['note_sur_20'] = $ep['possible'] > 0
                    ? round(($ep['obtenu'] / $ep['possible']) * 20, 2)
                    : 0;
            }
            unset($ep);

            $item['epreuves'] = $epreuvesDetail;
        }

        $resultats[] = $item;
    }

    http_response_code(200);
    echo json_encode($resultats);

// ===== POST — Le jury note une réponse ouverte =====
} else if ($method === 'POST') {

    if ($user->role !== 'jury') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé au jury"]);
        exit();
    }

    $data = json_decode(file_get_contents("php://input"), true);

    $reponse_id = $data['reponse_id'] ?? null;
    $points_obtenus = $data['points_obtenus'] ?? null;

    if (!$reponse_id || $points_obtenus === null) {
        http_response_code(400);
        echo json_encode(["message" => "Données manquantes (reponse_id ou points_obtenus)"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Récupérer le barème max de la question liée à cette réponse, pour valider la note
    $verif = $conn->prepare("
        SELECT q.points AS bareme, q.epreuve_id AS epreuve_id
        FROM reponses r
        INNER JOIN questions q ON r.question_id = q.id
        WHERE r.id = ?
    ");
    $verif->execute([$reponse_id]);
    $ligne = $verif->fetch(PDO::FETCH_ASSOC);

    if (!$ligne) {
        http_response_code(404);
        echo json_encode(["message" => "Réponse introuvable"]);
        exit();
    }

    // Vérification du cloisonnement par épreuve : même si le jury connaît
    // un reponse_id par appel direct à l'API, il ne peut noter que les épreuves pour
    // lesquelles il est explicitement affecté.
    if (!juryEstAffecteAEpreuve($conn, $user->id, $ligne['epreuve_id'])) {
        http_response_code(403);
        echo json_encode(["message" => "Vous n'êtes pas affecté à cette épreuve"]);
        exit();
    }

    if ($points_obtenus < 0 || $points_obtenus > $ligne['bareme']) {
        http_response_code(400);
        echo json_encode(["message" => "La note doit être comprise entre 0 et " . $ligne['bareme']]);
        exit();
    }

    $stmt = $conn->prepare("
        UPDATE reponses
        SET points_obtenus = ?, corrige_par = ?, date_correction = NOW()
        WHERE id = ?
    ");
    $stmt->execute([$points_obtenus, $user->id, $reponse_id]);

    // ===== Déclenchement du calcul automatique du résultat, si la copie est désormais complète =====

    // 1. Identifier la candidature et le concours concernés par cette réponse
    $candInfo = $conn->prepare("
        SELECT r.candidature_id, c.concours_id
        FROM reponses r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE r.id = ?
    ");
    $candInfo->execute([$reponse_id]);
    $candData = $candInfo->fetch(PDO::FETCH_ASSOC);
    $candidature_id = $candData['candidature_id'];
    $concours_id = $candData['concours_id'];

    // 2. Vérifier si TOUTES les réponses de cette candidature sont désormais notées
    // (soit par correction manuelle points_obtenus, soit automatiquement pour un QCM via est_correcte)
    $check = $conn->prepare("
        SELECT COUNT(*) 
        FROM reponses 
        WHERE candidature_id = ? 
          AND points_obtenus IS NULL 
          AND est_correcte IS NULL
    ");
    $check->execute([$candidature_id]);
    $nonNotees = $check->fetchColumn();

    if ($nonNotees == 0) {

        // 3. Calculer la note totale pondérée par coefficient
        // Étape A : note obtenue/possible PAR ÉPREUVE
        $parEpreuveStmt = $conn->prepare("
            SELECT  
                e.id AS epreuve_id,
                e.coefficient,
                SUM(CASE 
                        WHEN r.points_obtenus IS NOT NULL THEN r.points_obtenus
                        WHEN r.est_correcte = 1 THEN q.points
                        ELSE 0
                    END) AS obtenu_epreuve,
                SUM(q.points) AS possible_epreuve
            FROM reponses r
            INNER JOIN questions q ON r.question_id = q.id
            INNER JOIN epreuves e ON q.epreuve_id = e.id
            WHERE r.candidature_id = ?
            GROUP BY e.id, e.coefficient
        ");
        $parEpreuveStmt->execute([$candidature_id]);
        $epreuvesData = $parEpreuveStmt->fetchAll(PDO::FETCH_ASSOC);

        // Étape B : moyenne pondérée sur toutes les épreuves du concours
        $somme_ponderee = 0;
        $somme_coefficients = 0;

        foreach ($epreuvesData as $ep) {
            $note_epreuve_sur_20 = $ep['possible_epreuve'] > 0
                ? ($ep['obtenu_epreuve'] / $ep['possible_epreuve']) * 20
                : 0;

            $somme_ponderee += $note_epreuve_sur_20 * $ep['coefficient'];
            $somme_coefficients += $ep['coefficient'];
        }

        $note_totale = $somme_coefficients > 0 ? round($somme_ponderee / $somme_coefficients, 2) : 0;

        // 4. Insérer ou mettre à jour le résultat de ce candidat
        $upsert = $conn->prepare("
            INSERT INTO resultats (candidature_id, note_totale, date_publication)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE note_totale = VALUES(note_totale), date_publication = NOW()
        ");
        $upsert->execute([$candidature_id, $note_totale]);

        // 5. Recalculer le classement de TOUT le concours (impact global, car un nouveau résultat peut changer les rangs)
        recalculerClassement($conn, $concours_id);
    }

    http_response_code(200);
    echo json_encode(["message" => "Note enregistrée avec succès"]);

// ===== PUT — L'admin publie officiellement les résultats d'un concours =====
// C'est ce déclic qui rend les résultats visibles côté candidat. Avant ce PUT,
// les notes existent déjà en base mais restent invisibles pour eux.
} else if ($method === 'PUT') {

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès réservé à l'administrateur"]);
        exit();
    }

    $data = json_decode(file_get_contents("php://input"), true);
    $action = $data['action'] ?? null;
    $concours_id = $data['concours_id'] ?? null;

    if ($action !== 'publier' || !$concours_id) {
        http_response_code(400);
        echo json_encode(["message" => "Requête invalide"]);
        exit();
    }

    $conn = (new Database())->connect();

    // Sécurité métier : on refuse de publier un concours qui n'a encore aucun résultat calculé
    $checkStmt = $conn->prepare("
        SELECT COUNT(*) FROM resultats r
        INNER JOIN candidatures c ON r.candidature_id = c.id
        WHERE c.concours_id = ?
    ");
    $checkStmt->execute([$concours_id]);

    if ($checkStmt->fetchColumn() == 0) {
        http_response_code(400);
        echo json_encode(["message" => "Aucun résultat n'a encore été calculé pour ce concours, publication impossible"]);
        exit();
    }

    $stmt = $conn->prepare("UPDATE concours SET resultats_publies = 1 WHERE id = ?");
    $stmt->execute([$concours_id]);

    // === NOUVEAU (Chantier 3) : notification automatique à tous les candidats validés ===
    $concoursStmt = $conn->prepare("SELECT titre FROM concours WHERE id = ?");
    $concoursStmt->execute([$concours_id]);
    $concoursTitre = $concoursStmt->fetchColumn();

    $candidatsStmt = $conn->prepare("SELECT user_id FROM candidatures WHERE concours_id = ? AND statut = 'validé'");
    $candidatsStmt->execute([$concours_id]);
    $candidats = $candidatsStmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($candidats as $candidat) {
        creerNotification(
            $conn,
            $candidat['user_id'],
            "Résultats disponibles",
            "Les résultats du concours \"$concoursTitre\" sont désormais consultables.",
            'resultat',
            '/concours_fp/public/mes_resultats.html',
            $user->id
        );
    }

    http_response_code(200);
    echo json_encode(["message" => "Résultats publiés avec succès"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}