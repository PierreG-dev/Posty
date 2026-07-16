# Posty

Application web personnelle qui remplace deux workflows n8n :

- **Module LinkedIn** — planifie, génère et publie mes posts LinkedIn (thèmes, créneaux, file, génération IA, visuels).
- **Module Mailing** — prospection email : séquence automatique, campagnes ponctuelles, archivage IMAP, détection des bounces et des réponses.

Les deux modules sont **étanches** au niveau code (voir `CLAUDE.md`).

## Développement local

```bash
# 1. Installer les deps
npm install

# 2. Copier l'exemple d'env, remplir les valeurs
cp .env.example .env

# 3. Générer le hash du mot de passe (encodé base64 pour compat env)
npm run hash-password -- "monMotDePasse"
# → colle la ligne AUTH_PASSWORD_HASH=... dans .env

# 4. Générer les autres secrets
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"

# 5. Lancer Mongo (docker one-liner si tu n'en as pas)
docker run -d --name posty-mongo -p 27017:27017 mongo:7

# 6. Lancer les deux services (deux terminaux)
npm run dev        # web  → http://localhost:3000
npm run worker     # worker → tick toutes les 60 s
```

## Contrôles avant commit

```bash
npm run typecheck && npm run lint && npm test
```

Doit passer. Sinon on ne pousse pas.

## Déploiement (Coolify)

- **Une seule image Docker** (`Dockerfile` à la racine).
- **Deux services** Coolify pointant sur la même image et la même base MongoDB :
  - `web`   → `CMD ["npx", "next", "start", "-p", "3000"]` (défaut du Dockerfile).
  - `worker` → `command: node dist-worker/worker/index.js`, aucun port exposé.
- **Un volume persistant** monté sur `/data/assets` pour les visuels générés.
- Variables d'env : voir `.env.example`. Tous les secrets côté Coolify.
- `TZ=Europe/Paris` sur les deux services (ceinture + bretelles, le calcul est déjà en Europe/Paris via Luxon).

## Checklist délivrabilité (module Mailing — CDC-02 §10)

À valider **avant** le premier envoi réel, indépendamment du code :

- [ ] **SPF** publié sur `pierre-godino.com` — inclut le serveur SMTP sortant.
- [ ] **DKIM** signé sur tous les envois — clé publique publiée, signature vérifiée sur un mail test.
- [ ] **DMARC** publié — au minimum `p=none` pour observer, puis `p=quarantine`.
- [ ] Envois en **texte brut**, jamais de HTML.
- [ ] **Aucun pixel de suivi, aucun lien raccourci.**
- [ ] Volume plafonné à **25/jour**, jitter aléatoire entre envois.
- [ ] Arrêt immédiat sur bounce et sur réponse (§8 CDC-02).

## Structure

Voir `CLAUDE.md` pour la règle d'or entre modules et l'arborescence.
