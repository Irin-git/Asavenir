    <?php
    header("Access-Control-Allow-Origin: *");
    header("Content-Type: application/json; charset=UTF-8");
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");
    header("Access-Control-Allow-Headers: Content-Type, Authorization");

    // Si c'est une requête OPTIONS (navigateur vérifie d'abord), on stop là
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit();
    }

    // On récupère l'URL demandée
    $request = $_SERVER['REQUEST_URI'];
    $request = str_replace('/concours_fp/api/index.php', '', $request);
    $request = explode('/', trim(strtok($request, '?'), '/'))[0];

    // On redirige vers le bon fichier
    switch ($request) {
        case 'auth':
            require 'routes/auth.php';
            break;
        case 'concours':
            require 'routes/concours.php';
            break;
        case 'candidatures':
            require 'routes/candidatures.php';
            break;
        case 'documents':
            require 'routes/documents.php';
            break;
        case 'questions':
            require 'routes/questions.php';
            break;
        case 'epreuves':
            require 'routes/epreuves.php';
            break;
        case 'reponses':
            require 'routes/reponses.php';
            break;
        case 'exclusions':
            require 'routes/exclusions.php';
            break;
        case 'resultats':
            require 'routes/resultats.php';
            break;
        case 'affectations':
            require 'routes/affectations.php';
            break;
        case 'affectations_epreuve':
            require 'routes/affectations_epreuve.php';
            break;        
        default:
            http_response_code(404);
            echo json_encode(["message" => "Route introuvable"]);
            break;
    }