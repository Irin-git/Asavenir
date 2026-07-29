<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// POST — Postuler à un concours
if ($method === 'POST') {
    $user = verifierToken();

    // On vérifie que le concours_id est bien fourni avant d'aller plus loin
    if (empty($data['concours_id'])) {
        http_response_code(400);
        echo json_encode(["message" => "concours_id manquant"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // Vérifier si déjà candidat à ce concours (on ne peut pas postuler deux fois)
    $check = $conn->prepare("SELECT id FROM candidatures 
        WHERE user_id = ? AND concours_id = ?");
    $check->execute([$user->id, $data['concours_id']]);
    
    if ($check->fetch()) {
        http_response_code(409);
        echo json_encode(["message" => "Vous avez déjà postulé à ce concours"]);
        exit();
    }

    $stmt = $conn->prepare("INSERT INTO candidatures 
        (user_id, concours_id, statut) 
        VALUES (?, ?, 'en_attente')");
    
    $stmt->execute([$user->id, $data['concours_id']]);

    $candidature_id = $conn->lastInsertId();

    echo json_encode(["message" => "Candidature envoyée ✅", "candidature_id" => $candidature_id]);
}

// GET ALL — Admin voit toutes les candidatures, Jury voit celles en attente de décision
elseif ($method === 'GET' && isset($_GET['all'])) {
    $user = verifierToken();

    // Deux rôles autorisés désormais : admin (décision finale) et jury (avis consultatif)
    if (!in_array($user->role, ['admin', 'jury'])) {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $sql = "SELECT ca.id, ca.statut, ca.avis_jury, ca.created_at,
        u.nom AS candidat_nom,
        c.titre AS concours_titre
        FROM candidatures ca
        JOIN users u ON ca.user_id = u.id
        JOIN concours c ON ca.concours_id = c.id";

    // Le jury n'a besoin de voir que les candidatures pas encore tranchées par l'admin,
    // pour ne pas encombrer sa liste avec des dossiers déjà clos
    if ($user->role === 'jury') {
        $sql .= " WHERE ca.statut = 'en_attente'";
    }

    $sql .= " ORDER BY ca.created_at DESC";

    $stmt = $conn->prepare($sql);
    $stmt->execute();
    $candidatures = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($candidatures);
}

// GET — Voir ses propres candidatures (candidat connecté)
elseif ($method === 'GET') {
    $user = verifierToken();

    $db = new Database();
    $conn = $db->connect();

    $stmt = $conn->prepare("SELECT ca.id, c.titre, c.date_debut, c.date_fin, 
        ca.statut, ca.created_at 
        FROM candidatures ca
        JOIN concours c ON ca.concours_id = c.id
        WHERE ca.user_id = ?");
    
    $stmt->execute([$user->id]);
    $candidatures = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($candidatures);
}

// PUT — Deux usages distincts selon le rôle et le champ envoyé :
//   - { id, statut }    -> décision finale, réservée à l'admin
//   - { id, avis_jury } -> avis consultatif, réservé au jury
elseif ($method === 'PUT') {
    $user = verifierToken();

    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(["message" => "id manquant"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    // --- Cas 1 : l'admin change le statut final ---
    if (isset($data['statut'])) {
        if ($user->role !== 'admin') {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé : seul l'admin peut valider/rejeter une candidature"]);
            exit();
        }

        // On vérifie que le statut envoyé fait bien partie des valeurs autorisées
        // (évite qu'une valeur invalide se retrouve en base, ex: faute de frappe côté front)
        $statutsValides = ['en_attente', 'validé', 'rejeté'];
        if (!in_array($data['statut'], $statutsValides)) {
            http_response_code(400);
            echo json_encode(["message" => "Statut invalide"]);
            exit();
        }

        $stmt = $conn->prepare("UPDATE candidatures SET statut = ? WHERE id = ?");
        $stmt->execute([$data['statut'], $data['id']]);

        echo json_encode(["message" => "Statut mis à jour ✅"]);
        exit();
    }

    // --- Cas 2 : le jury donne son avis consultatif ---
    if (isset($data['avis_jury'])) {
        if ($user->role !== 'jury') {
            http_response_code(403);
            echo json_encode(["message" => "Accès refusé : seul le jury peut donner un avis"]);
            exit();
        }

        $avisValides = ['en_attente', 'favorable', 'defavorable'];
        if (!in_array($data['avis_jury'], $avisValides)) {
            http_response_code(400);
            echo json_encode(["message" => "Avis invalide"]);
            exit();
        }

        $stmt = $conn->prepare("UPDATE candidatures SET avis_jury = ? WHERE id = ?");
        $stmt->execute([$data['avis_jury'], $data['id']]);

        echo json_encode(["message" => "Avis enregistré ✅"]);
        exit();
    }

    // Ni statut ni avis_jury envoyé -> requête incomplète
    http_response_code(400);
    echo json_encode(["message" => "Aucune donnée valide à mettre à jour (statut ou avis_jury attendu)"]);

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}