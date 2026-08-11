<?php
class Database {
    /* Identifiants de production — hébergement InfinityFree */
    private $host = "sql207.infinityfree.com";
    private $db   = "if0_42626902_concours_fp";
    private $user = "if0_42626902";
    private $pass = "AsavenirProject";

    public function connect() {
        try {
            $pdo = new PDO(
                "mysql:host={$this->host};dbname={$this->db};charset=utf8mb4",
                $this->user,
                $this->pass
            );
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            return $pdo;
        } catch (PDOException $e) {
            die(json_encode(["error" => "Connexion échouée"]));
        }
    }
}