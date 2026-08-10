// Service Worker Asavenir - gestion des notifications Web Push
// Ce fichier tourne en arrière-plan, indépendamment de l'onglet/app ouvert(e)

// Étape d'installation : on active immédiatement sans attendre la fermeture des anciens onglets
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Étape d'activation : le nouveau Service Worker prend le contrôle direct de la page
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Réception d'une notification Push envoyée par le serveur (via minishlink/web-push)
self.addEventListener('push', (event) => {
    let data = {
        titre: 'Asavenir',
        message: 'Vous avez une nouvelle notification.',
        lien: '/concours_fp/public/concours.html'
    };

    // Le serveur envoie les données en JSON, on les récupère si présentes
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.message = event.data.text();
        }
    }

    const options = {
        body: data.message,
        icon: '/concours_fp/public/img/icon-placeholder.png',
        badge: '/concours_fp/public/img/icon-placeholder.png',
        data: {
            lien: data.lien || '/concours_fp/public/concours.html'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.titre, options)
    );
});

// Clic sur la notification : on ouvre (ou ramène au premier plan) la page concernée
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const urlToOpen = event.notification.data.lien;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url.includes('concours_fp') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});