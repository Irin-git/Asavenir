<?php
require_once __DIR__ . '/../../vendor/autoload.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

/**
 * Envoie un email contenant un code à 6 chiffres (reset ou 2FA).
 * $type = 'reset' ou '2fa' → change juste le texte du message.
 */
function envoyerEmailCode($destinataire, $nom, $code, $type = 'reset') {
    $config = require __DIR__ . '/../config/mailer.php';

    $mail = new PHPMailer(true);

    try {
        $mail->isSMTP();
        $mail->Host       = $config['host'];
        $mail->SMTPAuth   = true;
        $mail->Username   = $config['username'];
        $mail->Password   = $config['password'];
        $mail->SMTPSecure = 'tls';
        $mail->Port       = $config['port'];
        $mail->CharSet    = 'UTF-8';

        $mail->setFrom($config['from_email'], $config['from_name']);
        $mail->addAddress($destinataire, $nom);

        if ($type === '2fa') {
            $mail->Subject = "Votre code de connexion Asavenir";
            $texte = "Bonjour $nom,\n\nVotre code de connexion est : $code\n\nCe code expire dans 10 minutes.";
        } else {
            $mail->Subject = "Réinitialisation de votre mot de passe Asavenir";
            $texte = "Bonjour $nom,\n\nVotre code de réinitialisation est : $code\n\nCe code expire dans 15 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.";
        }

        $mail->isHTML(false);
        $mail->Body = $texte;

        $mail->send();
        return true;

    } catch (Exception $e) {
        error_log("Erreur envoi email : " . $mail->ErrorInfo);
        return false;
    }
}