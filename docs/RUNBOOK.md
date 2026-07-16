# RUNBOOK — Bascule Posty ↔ n8n et exploitation

> Ce document décrit la procédure de bascule (n8n → Posty), le rollback, les
> incidents fréquents, et la checklist délivrabilité. Il est destiné à l'humain
> qui opère Posty (moi). Il fait autorité **après** la mise en production.

---

## 1. Procédure de bascule (n8n → Posty)

Ordre à respecter. Chaque étape doit être verte avant de passer à la suivante.

### Étape 1 — Déploiement en `dryRun`

1. Déployer Posty sur Coolify (web + worker, même image). Volume `/data/assets`
   monté. `.env` complet (`.env.example` = référence).
2. Dans les réglages Posty :
   - **LinkedIn** : `settings.dryRun = true`.
   - **Mailing** : `settings.dryRun = true`. `settings.paused = false`.
3. Vérifier :
   - `/settings` → connexion Twenty OK (bouton « ping »).
   - `/linkedin` → OAuth LinkedIn connecté, URN présent.
   - `/mailing` → SMTP configuré (pas encore d'envoi), IMAP connecté.
   - `npm run worker` tourne (logs `worker.tick`).

### Étape 2 — Recette en `dryRun`, sans arrêter n8n

Posty et n8n tournent **en parallèle** pendant deux semaines pleines (soit 4
créneaux mailing : deux mardis 10:30, deux jeudis 14:00, et environ 6
publications LinkedIn).

Pendant cette période :

- **LinkedIn** : chaque créneau produit une entrée `publications` en dryRun
  (§10.7 CDC-01). Le payload doit être identique à ce que je publierais à la
  main. Aucun post ne part sur le profil.
- **Mailing** : chaque créneau enfile et écrit dans `mail_log` avec
  `dryRun=true`. Twenty n'est **pas** patché par Posty (le PATCH `dryRun`
  est court-circuité §6.2). En parallèle, n8n patche Twenty comme d'habitude.

### Étape 3 — Comparaison avec n8n

Le script `scripts/compare-with-n8n.ts` est le juge de paix. Il compare, sur la
fenêtre de deux semaines, ce que Posty aurait envoyé (côté DB Posty) et ce que
n8n a effectivement patché (côté Twenty).

```bash
# 1. Extraire ce que Posty AURAIT envoyé
tsx --env-file-if-exists=.env scripts/compare-with-n8n.ts \
    --posty-side --from=2026-07-01 --to=2026-07-14 --out=posty.json

# 2. Extraire ce que n8n a réellement fait (lit Twenty, read-only)
tsx --env-file-if-exists=.env scripts/compare-with-n8n.ts \
    --twenty-side --from=2026-07-01 --to=2026-07-14 --out=twenty.json

# 3. Comparer
tsx scripts/compare-with-n8n.ts --compare \
    --posty=posty.json --twenty=twenty.json --out=diff.json
```

**Verdict `green` (zéro écart) requis pour passer à l'étape 4.** Si `red` :
diagnostiquer, corriger, relancer une fenêtre de deux semaines. On ne bascule
pas sur un `red`.

### Étape 4 — Coupure de n8n

1. **Désactiver** les deux workflows n8n (workflow A et B). Ne pas les
   supprimer : on veut pouvoir les réactiver (rollback).
2. Vérifier une dernière fois qu'aucun autre workflow n8n ne touche à Twenty
   sur les champs `toContact`, `followupCount`, `lastContactedAt`,
   `nextFollowupAt`, `lastMessageId`.
3. Marquer la date et l'heure de coupure dans un post-it interne (utile pour
   corréler un incident aux 48 h qui suivent).

### Étape 5 — Sortie du `dryRun`

Après **24 h** au moins depuis l'étape 4, sans incident :

1. `settings.dryRun = false` côté Mailing.
2. `settings.dryRun = false` côté LinkedIn.
3. Vérifier au prochain créneau que le mail part vraiment (`mail_log.dryRun =
   false`, présence dans le dossier IMAP `Posty`) et que le post part vraiment
   (`publications.outcome = 'published'`, lien LinkedIn cliquable).
4. Pushover de test envoyé et reçu (bouton dans `/settings`).

Bascule terminée.

---

## 2. Rollback

**Le principe** : l'état de vérité est dans Twenty. Posty n'écrit dans Twenty
que ce que n8n écrivait déjà (§3.1 CDC-02). Un retour arrière n'implique donc
**aucune migration de données**.

### Rollback d'urgence (< 5 minutes)

1. `settings.paused = true` côté Mailing (arrêt de tous les envois).
2. `settings.dryRun = true` côté LinkedIn (arrêt de toute publication).
3. Réactiver les workflows n8n (workflow A et B).

À ce moment, n8n reprend la main sur Twenty comme avant.

### Rollback progressif

Si l'incident est cerné (bug LinkedIn seul, ou bug Mailing seul), on peut
rollback un seul module :

- LinkedIn seul : `dryRun=true` sur LinkedIn, garder Mailing en prod.
- Mailing seul : `paused=true` sur Mailing, réactiver le workflow n8n B, garder
  LinkedIn en prod.

---

## 3. Incidents fréquents et parades

### 3.1 Créneau manqué (worker down au moment du tick)

Posty rattrape automatiquement un créneau manqué de **moins de 15 minutes**
(§7.1 CDC-01, `CATCHUP_WINDOW_MIN`). Au-delà : loggé en `publications.skipped`,
Pushover envoyé, **pas** de rattrapage automatique.

Rejouer manuellement :

- LinkedIn : depuis `/linkedin`, bouton « Publier maintenant » sur le prochain
  post de la file.
- Mailing : l'entrée `mail_queue` reste en `pending` — elle sera reprise au
  créneau suivant. Rien à faire.

### 3.2 Token LinkedIn expiré

Le job quotidien `worker/jobs/refresh-token.ts` rafraîchit si l'access token
expire dans < 7 j, et notifie via Pushover si le refresh token expire dans
< 14 j. Si tu reçois l'alerte :

1. Aller sur `/linkedin/settings`.
2. Cliquer « Reconnecter » → OAuth complet.
3. Le nouveau refresh token est chiffré au repos (`ENCRYPTION_KEY`, AES-256-GCM).

### 3.3 Bounce hard sur un contact

Traitement automatique (§8 CDC-02) : `company_meta.bounce=hard`, Twenty PATCH
`isAutoHandled=false`, entrées de file annulées, Pushover envoyé. Aucune action
manuelle sauf si tu veux réhabiliter le contact (rare).

### 3.4 Réponse d'un prospect

Traitement automatique : `paused=true`, entrées en attente annulées, Pushover
envoyé. **Aucun changement de statut Twenty** (§8.2 CDC-02).

Décision humaine dans `/mailing/contacts/{id}` :
- « Passer en CLIENT dans Twenty » → PATCH `status=CLIENT`.
- « Reprendre la séquence » → `paused=false`.

### 3.5 Dépassement du quota 25/jour

Non seulement possible — c'est le comportement voulu (§6.2 CDC-02, priorités
1 > 2 > 3). Le dashboard affiche l'état exact : « 25/25 · dont 18 relances,
7 premiers contacts, 0 campagne — 34 en attente au prochain créneau ». Rien à
faire, la file s'écoulera aux créneaux suivants.

### 3.6 Purge d'une entrée de file

Dans `/mailing/queue`, sélectionner l'entrée, action « Annuler ». Ça pose
`status=cancelled` + `cancelReason='manual'`. L'entrée n'est plus reprise.

Si besoin de purger en masse (ex. bloc de test qui a fui) :
```javascript
db.mail_queue.updateMany(
  { status: 'pending', kind: 'campaign', campaignId: 'CAMP_ID' },
  { $set: { status: 'cancelled', cancelReason: 'manual-purge' } }
);
```

### 3.7 Alerte IMAP archivage KO

L'archivage n'est **jamais** critique : un échec `APPEND` sur le dossier
`Posty` produit `mail_log.imapArchived=false` et une notif, mais le mail a
déjà été envoyé (§7.2 CDC-02). **Ne PAS renvoyer** — c'est la règle
d'idempotence.

Diagnostic : vérifier que le dossier IMAP `Posty` existe (créé au démarrage
worker s'il manque), que les credentials IMAP sont bons, que le quota du compte
mail n'est pas saturé.

---

## 4. Checklist délivrabilité (SPF · DKIM · DMARC)

À vérifier **avant** de sortir du `dryRun` côté Mailing. Un mail envoyé sans
SPF/DKIM aligné finira en spam et brûlera la réputation du domaine.

### SPF

- [ ] Le domaine expéditeur (celui de `SMTP_FROM`) a un record TXT SPF publié.
- [ ] Ce record autorise l'IP ou le hostname du serveur SMTP utilisé.
- [ ] `dig TXT mondomaine.fr` renvoie une ligne `v=spf1 ... -all` ou `~all`.

### DKIM

- [ ] Un sélecteur DKIM est configuré chez le fournisseur SMTP.
- [ ] La clé publique DKIM est publiée en DNS : `dig TXT
      {selector}._domainkey.mondomaine.fr`.
- [ ] Un mail de test envoyé à `check-auth@verifier.port25.com` renvoie
      `DKIM check: pass`.

### DMARC

- [ ] Un record DMARC est publié : `dig TXT _dmarc.mondomaine.fr`.
- [ ] Politique au moins `p=quarantine` (idéalement `p=reject` après plusieurs
      semaines de propreté SPF+DKIM).
- [ ] `rua=mailto:...` pointe vers une adresse que tu relèves.

### Test global

Envoyer un mail depuis Posty en `dryRun=false` à `check-auth@verifier.port25.com`
puis à `mail-tester.com` (via une adresse jetable qu'ils fournissent).
Score ≥ 9/10 attendu.

---

## 5. Ce que la documentation ne remplace pas

- Les backups Mongo sont pris en charge par le serveur de sauvegarde externe
  (hors périmètre Posty). Vérifier que la base `posty` y est bien incluse
  avant l'étape 4 de la bascule.
- Une routine de rotation des logs applicatifs (10 Mo max en dev, journald
  gère la taille en prod si `docker logs` reste borné).
- Un test annuel du rollback : désactiver Posty, réactiver n8n, envoyer un
  mail de test, vérifier que ça part et que Twenty est patché comme avant.
