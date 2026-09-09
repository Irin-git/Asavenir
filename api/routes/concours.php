<?php
require_once __DIR__ . '/../../vendor/autoload.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../middleware/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);

// GET — Liste tous les concours
if ($method === 'GET') {
    $user = verifierToken();
    
    $db = new Database();
    $conn = $db->connect();
    
    $stmt = $conn->prepare("SELECT * FROM concours");
    $stmt->execute();
    $concours = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode($concours);
}

// POST — Créer un concours (admin seulement)
elseif ($method === 'POST') {
    $user = verifierToken();
    
    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé, admin seulement"]);
        exit();
    }

    // Vérification des champs obligatoires avant d'aller plus loin
    if (empty($data['titre']) || empty($data['description']) || empty($data['date_debut']) || empty($data['date_fin'])) {
        http_response_code(400);
        echo json_encode(["message" => "Titre, description, date_debut et date_fin sont obligatoires"]);
        exit();
    }

    // Catégorisation des postes — on limite aux catégories connues (évite une faute de frappe en base)
    $categoriesValides = ['Administratif', 'Enseignement', 'Santé', 'Technique', 'Sécurité', 'Autre'];
    $categorie = $data['categorie'] ?? 'Autre';
    if (!in_array($categorie, $categoriesValides)) {
        $categorie = 'Autre';
    }
    
    $db = new Database();
    $conn = $db->connect();
    
    // Conditions d'éligibilité et frais d'inscription : tous facultatifs (null si non renseignés),
    // un concours reste valide même sans condition particulière ou sans frais
    $stmt = $conn->prepare("INSERT INTO concours 
        (titre, description, date_debut, date_fin, statut, nb_places, categorie,
         diplome_requis, age_min, age_max, conditions_autres, frais_montant, frais_description) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    
    $stmt->execute([
        $data['titre'],
        $data['description'],
        $data['date_debut'],
        $data['date_fin'],
        $data['statut'] ?? 'ouvert',
        $data['nb_places'] ?? null,
        $categorie,
        $data['diplome_requis'] ?: null,
        $data['age_min'] ?: null,
        $data['age_max'] ?: null,
        $data['conditions_autres'] ?: null,
        $data['frais_montant'] ?: null,
        $data['frais_description'] ?: null
    ]);
    
    echo json_encode(["message" => "Concours créé ✅"]);

// DELETE — Supprimer un concours ET toutes les données qui en dépendent (admin seulement)
// NOUVEAU : évite d'avoir à supprimer à la main dans phpMyAdmin, ce qui laissait des
// données orphelines pointant vers des ID réutilisés par la suite (bug de "casiers réutilisés").
} elseif ($method === 'DELETE') {
    $user = verifierToken();

    if ($user->role !== 'admin') {
        http_response_code(403);
        echo json_encode(["message" => "Accès refusé, admin seulement"]);
        exit();
    }

    $concours_id = $data['id'] ?? null;
    if (!$concours_id) {
        http_response_code(400);
        echo json_encode(["message" => "id manquant"]);
        exit();
    }

    $db = new Database();
    $conn = $db->connect();

    $verif = $conn->prepare("SELECT id FROM concours WHERE id = ?");
    $verif->execute([$concours_id]);
    if (!$verif->fetch()) {
        http_response_code(404);
        echo json_encode(["message" => "Concours introuvable"]);
        exit();
    }

    $conn->beginTransaction();
    try {
        // On récupère d'abord les ID des enfants directs, pour supprimer les petits-enfants
        $epreuveIds = $conn->prepare("SELECT id FROM epreuves WHERE concours_id = ?");
        $epreuveIds->execute([$concours_id]);
        $epreuveIds = $epreuveIds->fetchAll(PDO::FETCH_COLUMN);

        $candidatureIds = $conn->prepare("SELECT id FROM candidatures WHERE concours_id = ?");
        $candidatureIds->execute([$concours_id]);
        $candidatureIds = $candidatureIds->fetchAll(PDO::FETCH_COLUMN);

        // ----- Tout ce qui dépend des CANDIDATURES -----
        if (!empty($candidatureIds)) {
            $in = implode(',', array_fill(0, count($candidatureIds), '?'));
            $conn->prepare("DELETE FROM reponses WHERE candidature_id IN ($in)")->execute($candidatureIds);
            $conn->prepare("DELETE FROM exclusions WHERE candidature_id IN ($in)")->execute($candidatureIds);
            $conn->prepare("DELETE FROM documents WHERE candidature_id IN ($in)")->execute($candidatureIds);
            $conn->prepare("DELETE FROM resultats WHERE candidature_id IN ($in)")->execute($candidatureIds);
            $conn->prepare("DELETE FROM affectations_salle WHERE candidature_id IN ($in)")->execute($candidatureIds);
        }

        // ----- Tout ce qui dépend des ÉPREUVES -----
        if (!empty($epreuveIds)) {
            $in = implode(',', array_fill(0, count($epreuveIds), '?'));
            $conn->prepare("DELETE FROM choix_reponses WHERE question_id IN (SELECT id FROM questions WHERE epreuve_id IN ($in))")->execute($epreuveIds);
            $conn->prepare("DELETE FROM questions WHERE epreuve_id IN ($in)")->execute($epreuveIds);
            $conn->prepare("DELETE FROM salles_epreuve WHERE epreuve_id IN ($in)")->execute($epreuveIds);
            $conn->prepare("DELETE FROM jury_affectations_epreuve WHERE epreuve_id IN ($in)")->execute($epreuveIds);
        }

        // ----- Enfants directs du concours, puis le concours lui-même -----
        $conn->prepare("DELETE FROM epreuves WHERE concours_id = ?")->execute([$concours_id]);
        $conn->prepare("DELETE FROM jury_affectations_concours WHERE concours_id = ?")->execute([$concours_id]);
        $conn->prepare("DELETE FROM candidatures WHERE concours_id = ?")->execute([$concours_id]);
        $conn->prepare("DELETE FROM concours WHERE id = ?")->execute([$concours_id]);

        $conn->commit();
        echo json_encode(["message" => "Concours et toutes ses données associées supprimés ✅"]);
    } catch (Exception $e) {
        $conn->rollBack();
        http_response_code(500);
        echo json_encode(["message" => "Erreur lors de la suppression", "erreur" => $e->getMessage()]);
    }

} else {
    http_response_code(405);
    echo json_encode(["message" => "Méthode non autorisée"]);
}