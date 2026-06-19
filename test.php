<?php
require 'api/config/database.php';
$db = new Database();
$conn = $db->connect();
echo "Connexion OK ✅";