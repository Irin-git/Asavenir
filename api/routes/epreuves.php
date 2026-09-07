<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$user = verifierToken();

if ($method === 'POST') {
    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }

    if (empty($data['concours_id']) || empty($data['titre']) || empty($data['type']) || empty($data['duree']) || empty($data['date_epreuve'])) {
        http_response_code(400);
        echo json_encode(["message" => "Champs obligatoires manquants"]);
        exit();
    }

    $conn = (new Database())->connect();
    $conn->beginTransaction();

    try {
        $stmt = $conn->prepare("INSERT INTO epreuves (concours_id, titre, type, duree, date_epreuve, coefficient, statut) VALUES (?, ?, ?, ?, ?, ?, 'planifiée')");
        $stmt->execute([$data['concours_id'], $data['titre'], $data['type'], $data['duree'], $data['date_epreuve'], $data['coefficient'] ?: 1]);
        $epreuve_id = $conn->lastInsertId();

        // === NOUVEAU (Chantier 5) : une ou plusieurs salles peuvent être créées directement avec l'épreuve ===
        // Chaque salle a un nom et, optionnellement, une capacité (utilisée plus tard pour la répartition automatique)
        if (!empty($data['salles']) && is_array($data['salles'])) {
            $stmtSalle = $conn->prepare("INSERT INTO salles_epreuve (epreuve_id, nom_salle, capacite) VALUES (?, ?, ?)");
            foreach ($data['salles'] as $salle) {
                if (empty($salle['nom_salle'])) continue;
                $stmtSalle->execute([$epreuve_id, $salle['nom_salle'], $salle['capacite'] ?: null]);
            }
        }

        $conn->commit();
        echo json_encode(["message" => "Épreuve créée ✅", "id" => $epreuve_id]);
    } catch (Exception $e) {
        $conn->rollBack();
        http_response_code(500);
        echo json_encode(["message" => "Erreur lors de la création de l'épreuve"]);
    }

} elseif ($method === 'GET') {
    $conn = (new Database())->connect();
    $concours_id = $_GET['concours_id'] ?? null;
    $en_attente = $_GET['en_attente'] ?? null;
    $mes_epreuves = $_GET['mes_epreuves'] ?? null;
    // NOUVEAU : liste des concours pour lesquels LE JURY connecté a au moins une épreuve affectée
    $mes_concours_jury = $_GET['mes_concours_jury'] ?? null;

    // Liste des épreuves auxquelles LE candidat connecté peut accéder (via ses candidatures validées)
    if ($mes_epreuves) {
        // === NOUVEAU (Chantier 5) : ma_salle = la salle qui M'a été assignée pour CETTE épreuve précise
        // (jointure LEFT car la répartition peut ne pas encore avoir été faite par l'admin)
        // === NOUVEAU (Chantier 5 - paiement) : AND cd.paiement_effectue = 1 -> bloque l'accès tant que
        // l'admin n'a pas coché le paiement des frais d'inscription comme reçu
        $sql = "SELECT e.*, c.titre AS concours_titre, cd.id AS candidature_id, (e.date_epreuve <= NOW()) AS est_accessible,
            EXISTS (SELECT 1 FROM reponses r WHERE r.candidature_id = cd.id) AS deja_soumise,
            EXISTS (SELECT 1 FROM exclusions ex WHERE ex.candidature_id = cd.id AND ex.epreuve_id = e.id) AS est_exclu,
            se.nom_salle AS ma_salle
            FROM epreuves e
            JOIN concours c ON c.id = e.concours_id
            JOIN candidatures cd ON cd.concours_id = e.concours_id
            LEFT JOIN affectations_salle aff ON aff.epreuve_id = e.id AND aff.candidature_id = cd.id
            LEFT JOIN salles_epreuve se ON se.id = aff.salle_id
            WHERE cd.user_id = ?
            AND cd.statut = 'validé'
            AND cd.paiement_effectue = 1
            ORDER BY e.date_epreuve";

        // Nettoyage : remplace les espaces invisibles par de vrais espaces
        $sql = str_replace("\xC2\xA0", " ", $sql);
        $sql = preg_replace('/\s+/', ' ', $sql);

        $stmt = $conn->prepare($sql);
        $stmt->execute([$user->id]);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
        exit();
    }

    // NOUVEAU BLOC : concours où le JURY connecté a au moins une épreuve affectée
    if ($mes_concours_jury) {
        if ($user->role !== 'jury') {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé : réservé aux membres du jury"]);
            exit();
        }

        $stmt = $conn->prepare("
            SELECT DISTINCT c.id, c.titre
            FROM concours c
            JOIN epreuves e ON e.concours_id = c.id
            JOIN jury_affectations_epreuve jae ON jae.epreuve_id = e.id
            WHERE jae.jury_id = ?
            ORDER BY c.titre ASC
        ");
        $stmt->execute([$user->id]);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
        exit();
    }

    // Liste de TOUTES les épreuves, utilisée par l'écran "Gestion des épreuves" de l'admin
    if ($en_attente) {
        if (!in_array($user->role, ['admin', 'jury'])) {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé"]);
            exit();
        }

        // === NOUVEAU (Chantier 5) : nb_salles, utile pour afficher un badge "3 salles configurées"
        // dans la liste, sans avoir à ouvrir le détail de chaque épreuve
        $stmt = $conn->prepare("
            SELECT e.*, c.titre AS concours_titre,
                   (e.date_epreuve > NOW()) AS modifiable,
                   (SELECT COUNT(*) FROM salles_epreuve se WHERE se.epreuve_id = e.id) AS nb_salles
            FROM epreuves e
            JOIN concours c ON c.id = e.concours_id
            ORDER BY e.id DESC
        ");
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
        exit();
    }

    if (!$concours_id) {
        http_response_code(400);
        echo json_encode(["message" => "concours_id manquant"]);
        exit();
    }

    // ===== Étape 2 du cloisonnement jury : filtrage par épreuve précise =====
    if ($user->role === 'jury') {
        $stmt = $conn->prepare("
            SELECT e.*
            FROM epreuves e
            JOIN jury_affectations_epreuve jae ON jae.epreuve_id = e.id
            WHERE e.concours_id = ?
            AND jae.jury_id = ?
            ORDER BY e.date_epreuve
        ");
        $stmt->execute([$concours_id, $user->id]);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
        exit();
    }

    $stmt = $conn->prepare("SELECT * FROM epreuves WHERE concours_id = ? ORDER BY date_epreuve");
    $stmt->execute([$concours_id]);
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

} elseif ($method === 'PUT') {
    $conn = (new Database())->connect();
    $epreuve_id = $data['id'] ?? null;

    if (!$epreuve_id || !is_numeric($epreuve_id)) {
        http_response_code(400);
        echo json_encode(["message" => "ID épreuve manquant ou invalide"]);
        exit();
    }

    http_response_code(403);
    echo json_encode(["message" => "Accès refusé"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}
