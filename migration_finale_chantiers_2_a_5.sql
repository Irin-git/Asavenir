-- =========================================================================
-- MIGRATION CONSOLIDÉE — Chantiers 2, 3, 4 et 5
-- À exécuter une seule fois dans phpMyAdmin, sur la base LOCALE (WAMP)
-- ET sur la base de PRODUCTION (InfinityFree).
-- =========================================================================

-- ===== Chantier 2 : authentification 2FA (admin/jury) =====
CREATE TABLE two_factor_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    code VARCHAR(6) NOT NULL,
    expire_at DATETIME NOT NULL,
    utilise TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== Chantier 3 : rappels d'épreuve automatiques =====
ALTER TABLE epreuves
ADD COLUMN rappel_envoye TINYINT(1) NOT NULL DEFAULT 0;

-- ===== Chantier 4 : catégorisation des postes =====
ALTER TABLE concours
ADD COLUMN categorie VARCHAR(30) NOT NULL DEFAULT 'Autre';

-- ===== Chantier 5 : conditions d'éligibilité + frais d'inscription =====
ALTER TABLE concours
ADD COLUMN diplome_requis VARCHAR(150) NULL,
ADD COLUMN age_min INT NULL,
ADD COLUMN age_max INT NULL,
ADD COLUMN conditions_autres TEXT NULL,
ADD COLUMN frais_montant INT NULL,
ADD COLUMN frais_description VARCHAR(255) NULL;

-- ===== Chantier 5 : suivi manuel du paiement des frais d'inscription =====
ALTER TABLE candidatures
ADD COLUMN paiement_effectue TINYINT(1) NOT NULL DEFAULT 0;

-- ===== Chantier 5 : répartition des candidats dans plusieurs salles par épreuve =====
CREATE TABLE salles_epreuve (
    id INT AUTO_INCREMENT PRIMARY KEY,
    epreuve_id INT NOT NULL,
    nom_salle VARCHAR(100) NOT NULL,
    capacite INT NULL,
    FOREIGN KEY (epreuve_id) REFERENCES epreuves(id) ON DELETE CASCADE
);

CREATE TABLE affectations_salle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    epreuve_id INT NOT NULL,
    candidature_id INT NOT NULL,
    salle_id INT NOT NULL,
    UNIQUE KEY uniq_candidat_epreuve (epreuve_id, candidature_id),
    FOREIGN KEY (epreuve_id) REFERENCES epreuves(id) ON DELETE CASCADE,
    FOREIGN KEY (candidature_id) REFERENCES candidatures(id) ON DELETE CASCADE,
    FOREIGN KEY (salle_id) REFERENCES salles_epreuve(id) ON DELETE CASCADE
);
