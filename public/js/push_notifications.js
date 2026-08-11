// push-notifications.js
// Gère l'enregistrement du Service Worker et l'abonnement aux notifications Push
// Fichier séparé pour ne pas toucher à concours.js existant

const VAPID_PUBLIC_KEY = 'BIl9i2PcnQPOgYBuLjWVRojzpSB9oB7j-H8PpPlQNSoRyvoUrf0xrGSZ_Q8CQ1sfKr5mRzOsgVA3VhNgEWHG0IU';

// Convertit la clé VAPID (format base64 URL-safe) en tableau d'octets attendu par l'API Push
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function initPushNotifications() {
    // Vérifie que le navigateur supporte Service Worker + Push
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('Web Push non supporté par ce navigateur.');
        return;
    }

    try {
        // Enregistre le Service Worker
        const registration = await navigator.serviceWorker.register('/sw.js');

        // Demande la permission au candidat
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Permission notifications refusée.');
            return;
        }

        // Vérifie si un abonnement existe déjà pour éviter les doublons
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        // Envoie l'abonnement au serveur pour stockage en base
        await envoyerAbonnementAuServeur(subscription);

    } catch (error) {
        console.error('Erreur lors de l\'initialisation du Push:', error);
    }
}

async function envoyerAbonnementAuServeur(subscription) {
    const token = localStorage.getItem('token');
    const sub = subscription.toJSON();

    await fetch('/api/index.php/push_subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
            endpoint: sub.endpoint,
            public_key: sub.keys.p256dh,
            auth_token: sub.keys.auth
        })
    });
}

// Lance l'initialisation dès que la page candidat est chargée
document.addEventListener('DOMContentLoaded', initPushNotifications);