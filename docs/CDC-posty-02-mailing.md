# Cahier des charges — « Posty »
## Module 2 — Mailing de prospection

> Spécification destinée à **Claude Code**. Version 1.0.
> **Le socle est défini dans `CDC-posty-01-linkedin.md`** (stack, design system, auth, worker, Pushover, sécurité, modularité). Il n'est **pas** redéfini ici. Ce document ne décrit que le domaine Mailing.
>
> Rappel de la règle d'or : `modules/linkedin` et `modules/mailing` **ne s'importent jamais l'un l'autre**. Ils partagent le socle (`shared/`), le worker, le design system et la base MongoDB. Rien d'autre.

---

## 0. ⚠️ À faire avant toute ligne de code

**Le token Twenty actuel est compromis.** Il est en clair dans les deux workflows n8n, il transite en **query string** (`?token=…`) dans le workflow quotidien — donc journalisé par tout reverse-proxy de la chaîne — et il expire en **2126**.

1. **Révoquer et régénérer** la clé API Twenty.
2. Dans Posty : `TWENTY_API_KEY` en `.env`, envoyée **exclusivement** en header `Authorization: Bearer`. **Jamais** en query string.
3. L'instance Twenty est exposée en `http://` sur IP nue (`151.80.233.181:7749`) : le token circule en clair. Mettre du TLS devant (reverse-proxy Coolify + domaine), ou à défaut restreindre l'accès au réseau du VPS.

---

## 1. L'existant — ce qui est repris tel quel

Deux workflows n8n, à remplacer sans rien casser.

### 1.1 Workflow A — le marqueur d'éligibilité (tous les jours, 6 h)
Lit Twenty sur `isAutoHandled = true`, puis pose `toContact = true` sur ce qui est dû :
- `PROSPECT` → dû si `nextFollowupAt` est nul **ou** dépassé.
- `CLIENT` / `PARTENAIRE` → dû si `lastContactedAt` est nul **ou** vieux de plus de **60 jours**.

### 1.2 Workflow B — l'envoyeur (mardi 10 h 30, jeudi 14 h)
Lit `isAutoHandled && toContact && contactEmail.primaryEmail != null`, puis :
- **contingentement** : toutes les relances (`followupCount > 0`) passent ; les nouveaux (`followupCount == 0`) sont plafonnés à **15 par run** ;
- template choisi par `followupCount` (0 / 1 / 2, clampé à 2) ;
- un LLM (Groq) génère **uniquement la salutation**, injectée à la place de `{{INTRO}}` dans un corps figé ;
- envoi SMTP en **texte brut**, BCC vers `logs@`, `replyTo = lastMessageId` pour threader les relances ;
- PATCH Twenty : `toContact=false`, `followupCount++`, `lastContactedAt=today`, `nextFollowupAt` à **+5 j** puis **+9 j** puis **+2 mois**, `lastMessageId`, `messageReferences` ;
- **Wait aléatoire** avant l'item suivant, puis boucle.

### 1.3 La sémantique métier (à ne jamais trahir)
| Statut | Signification |
|---|---|
| `PROSPECT` | Entreprise démarchée ou à démarcher |
| `CLIENT` | **A répondu** à un mail d'intro |
| `PARTENAIRE` | Géré à la main, hors automatisation |

`isAutoHandled = false` est le **kill-switch** : le contact sort de tout traitement automatique. Posty le respecte et le réutilise (§8).

### 1.4 Les deux impasses de l'existant
1. **`CLIENT` et `PARTENAIRE` sont marqués, jamais envoyés.** Workflow A leur met `toContact=true` tous les 60 jours ; le Switch de workflow B n'a que sa sortie « Prospects » branchée. Ils restent `toContact=true` indéfiniment, repêchés à chaque run, sans qu'aucun mail ne parte.
2. **`followupCount = 3` tombe dans le vide.** Après le 3ᵉ mail, `nextFollowupAt` est posé à +2 mois. Deux mois plus tard, workflow A les remarque… et `Switch1` les jette dans sa sortie `3+`, branchée nulle part.

**Cette sortie `3+` vide est exactement l'emplacement des campagnes ponctuelles.** Le workflow avait prévu la place, il ne l'a jamais remplie.

---

## 2. Ce que Posty ajoute

1. **Archivage IMAP** des mails envoyés dans un dossier dédié (le BCC ne suffit pas).
2. **Campagnes ponctuelles** vers les contacts sortis de la séquence : corps rédigé à la main, blocs rigides réutilisables, salutation automatique conservée, mise en file d'attente.
3. **Modularité** : tout ce qui est en dur (templates, signature, délais, jours et heures d'envoi, plafond, jitter) devient éditable depuis l'UI.
4. **Détection des bounces** → arrêt automatique.
5. **Détection des réponses** → alerte + mise en pause, **sans changement de statut automatique**.
6. **Salutation sortie du chemin d'envoi** : calculée une fois, mise en cache.
7. **Une file d'envoi unique**, priorisée, visible et éditable avant départ.

---

## 3. Architecture — Twenty reste le CRM

**Twenty est la source de vérité des contacts.** Posty ne duplique pas les contacts : il lit et écrit via l'API REST.

```
┌──────────────┐   REST    ┌──────────────┐
│  Twenty CRM  │◄─────────►│    Posty     │
│  companies   │           │  file, campagnes,
│  (vérité)    │           │  logs, blocs, meta
└──────────────┘           └──────┬───────┘
                                  │ SMTP (envoi)
                                  │ IMAP  (archivage, bounces, réponses)
                                  ▼
                          contact@pierre-godino.com
```

### 3.1 Champs Twenty — on ne casse rien
Posty écrit **exactement les mêmes champs** que n8n aujourd'hui : `toContact`, `followupCount`, `lastContactedAt`, `nextFollowupAt`, `lastMessageId`, `messageReferences`, `isAutoHandled`.

> Conséquence recherchée : **tu peux revenir à n8n à tout moment.** L'état vit dans le CRM, pas dans Posty. Aucun champ personnalisé nouveau n'est requis dans Twenty.

`toContact` reste écrit, bien qu'il devienne techniquement redondant avec la file de Posty : il garde une valeur d'information dans l'UI de Twenty, et il est ta porte de sortie.

### 3.2 Ce qui vit dans Posty
Uniquement ce qui est **propre à l'envoi** : la file, les campagnes, les blocs, les logs, les bounces, et les métadonnées dérivées (salutation, pause).

### 3.3 Snapshot à l'enfilement
Quand une entrée entre dans la file, Posty **fige** `{ name, email, greeting }` dedans. La boucle d'envoi ne dépend donc plus de la disponibilité de Twenty, et ce que tu vois dans la file est exactement ce qui partira.

---

## 4. Modèle de données

### 4.1 `mail_settings` (singleton)
```ts
{
  _id: 'singleton',

  sendDays: [                      // ex-cron de workflow B, désormais éditable
    { dayOfWeek: 2, time: "10:30" },   // mardi
    { dayOfWeek: 4, time: "14:00" }    // jeudi
  ],
  dailyCap: 25,                    // plafond GLOBAL par jour d'envoi (§6.3)
  jitter: { minSeconds: 45, maxSeconds: 180 },   // pause entre deux envois

  sequence: {
    delays: [5, 9, 60],            // jours : après mail 0 → +5 j, après 1 → +9 j, après 2 → +60 j
    clientRelanceDays: 60          // conservé de workflow A, voir §5.3
  },

  smtp:    { host, port, secure, user, pass, from: 'contact@pierre-godino.com' },
  imap:    { host, port, user, pass, archiveFolder: 'Posty' },
  bccLogs: 'logs@pierre-godino.com' | null,      // filet pendant la bascule (§7.3)

  paused: false,                   // arrêt d'urgence global
  dryRun: false                    // simule tout, n'envoie rien
}
```

### 4.2 `mail_blocks` — les parties rigides
```ts
{
  _id, name: "Signature complète",
  kind: 'signature' | 'footer' | 'custom',
  content: string,                 // texte brut, multi-lignes
  isDefault: boolean,              // pré-coché à la création d'une campagne
  createdAt, updatedAt
}
```
Seed : la signature actuelle (nom, titre, email, WhatsApp, LinkedIn, CV, plateforme), extraite du code n8n.

### 4.3 `mail_templates` — les 3 mails de séquence
```ts
{
  _id, step: 0 | 1 | 2,
  subject: string,                 // "Formateur dev web disponible" / "Re: …"
  body: string,                    // corps, avec {{GREETING}} et {{BLOCK:signature}}
  blockIds: ObjectId[],            // blocs appendés en pied
  updatedAt
}
```
Seed : les trois templates actuels, **à l'identique**.

### 4.4 `campaigns`
```ts
{
  _id, name: "Relance rentrée 2026",
  subject: string,                 // NOUVEAU sujet — la campagne crée un nouveau fil (§6.5)
  body: string,                    // rédigé à la main, texte brut, identique pour tous
  blockIds: ObjectId[],            // blocs rigides choisis
  targetIds: string[],             // ids Twenty, sélectionnés À LA MAIN (§6.4)
  status: 'draft' | 'queued' | 'sending' | 'done' | 'cancelled',
  stats: { total, sent, failed, cancelled },
  createdAt, queuedAt, completedAt
}
```

### 4.5 `mail_queue` — la file unique
```ts
{
  _id,
  companyId: string,               // id Twenty
  snapshot: { name, email, greeting },   // figé à l'enfilement (§3.3)

  kind: 'sequence' | 'campaign',
  sequenceStep: 0 | 1 | 2 | null,
  campaignId: ObjectId | null,

  priority: 1 | 2 | 3,             // 1 relance · 2 premier contact · 3 campagne

  subject: string,                 // RENDU à l'enfilement — ce que tu vois partira
  body: string,
  threading: { inReplyTo, references } | null,   // null pour une campagne

  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled',
  attempts: number, lastError: string | null,
  messageId: string | null,
  createdAt, sentAt
}
```
**Index uniques (anti-doublon, non négociables) :**
- `{ companyId, kind: 'sequence', sequenceStep }` → un seul mail par étape et par contact.
- `{ companyId, campaignId }` → un seul mail par campagne et par contact.

**Index de tri :** `{ status, priority, createdAt }`.

### 4.6 `company_meta` — les données dérivées de Posty
```ts
{
  _id, companyId: string,          // id Twenty, unique
  greeting: string | null,         // "Bonjour l'équipe d'O'Clock," — calculée UNE FOIS (§6.1)
  greetingEditedByHuman: boolean,

  paused: boolean,                 // §8.2
  pausedReason: 'reply' | 'manual' | null,
  pausedAt: Date | null,

  bounce: { kind: 'hard' | 'soft', count: number, lastAt: Date, lastCode: string } | null,

  updatedAt
}
```

### 4.7 `mail_log`
```ts
{
  _id, companyId, queueId, campaignId,
  kind, sequenceStep,
  to, subject,
  sentAt, messageId,
  smtpOk: boolean, imapArchived: boolean,
  twentyPatched: boolean,
  error: string | null,
  durationMs
}
```
Sert au décompte du quota du jour, au suivi des campagnes, et au debug sans SSH.

---

## 5. Le job d'éligibilité (quotidien, 6 h — Europe/Paris)

Remplace le workflow A. Il **enfile** au lieu de simplement marquer.

```
companies = Twenty.GET(filter: isAutoHandled = true)

pour chaque company :
    SI company_meta.paused           → ignorer
    SI company_meta.bounce = 'hard'  → ignorer
    SI pas d'email                   → ignorer

    SI status == 'PROSPECT' :
        SI followupCount >= 3        → fin de séquence, ignorer (éligible aux campagnes)
        SI !nextFollowupAt OU today >= nextFollowupAt :
            enqueue(company, kind='sequence', step=followupCount)
            Twenty.PATCH { toContact: true }
```

### 5.1 `enqueue(company, kind='sequence', step)`
1. Récupérer ou calculer la **salutation** (§6.1). Jamais bloquant : à défaut, `"Bonjour,"`.
2. Rendre le `subject` et le `body` depuis `mail_templates[step]` : `{{GREETING}}` et les blocs sont substitués **maintenant**.
3. `threading` : `step 0` → `null` ; `step 1` et `2` → `{ inReplyTo: lastMessageId, references: messageReferences }`.
4. `priority` : `step 0` → **2** ; `step 1 ou 2` → **1**.
5. Insérer dans `mail_queue`. **En cas de violation de l'index unique → ignorer silencieusement.** C'est le garde-fou anti-doublon.

### 5.2 Rattrapage
Si le job n'a pas tourné (worker down), le lendemain rattrape naturellement : la condition est `today >= nextFollowupAt`, pas une égalité. Comportement identique à l'existant.

### 5.3 `CLIENT` et `PARTENAIRE` — décision explicite
Aujourd'hui, workflow A les marque `toContact=true` tous les 60 jours, et **aucun mail ne part jamais** (impasse n°1). Posty **ne les enfile pas en séquence** : le comportement observable est donc **strictement identique** (zéro mail envoyé), mais sans le marquage fantôme qui pollue le CRM.

- Les `CLIENT` sont éligibles aux **campagnes** (§6.4).
- Les `PARTENAIRE` restent entièrement manuels, comme tu l'as demandé.
- Le champ `sequence.clientRelanceDays` est conservé dans les réglages, inutilisé. Si tu veux plus tard une vraie relance à 60 jours des clients, ce sera une **campagne récurrente**, pas une séquence. → point ouvert, §12.

---

## 6. Le job d'envoi (mardi 10 h 30, jeudi 14 h — configurable)

Remplace le workflow B.

### 6.1 La salutation — sortie du chemin critique
Aujourd'hui elle est régénérée à chaque mail, **au milieu de la boucle d'envoi** : c'est une latence et un mode de panne au pire endroit possible.

Désormais :
- Calculée **une seule fois par contact**, à l'enfilement (ou par un job de rattrapage), puis stockée dans `company_meta.greeting`.
- **API Anthropic** (`claude-haiku-4-5`, `temperature: 0`, `max_tokens: 100`). Groq disparaît : une seule clé, un seul fournisseur. C'est de la normalisation de nom, Haiku suffit très largement.
- Le prompt actuel est repris **tel quel** (règles de casse, articles « du / de la / des », gestion de « lereacteur » → « du Reacteur »).
- **Éditable à la main** dans l'UI — indispensable, les noms d'organismes sont parfois retors.
- Échec → `"Bonjour,"`. **Jamais bloquant.**

### 6.2 La boucle
```
SI settings.paused → sortir.
quota  = settings.dailyCap                       (25)
déjà   = mail_log.count(sentAt = aujourd'hui)
restant = quota - déjà

TANT QUE restant > 0 :
    entry = mail_queue.findOneAndUpdate(
        { status: 'pending' },
        sort: { priority: 1, createdAt: 1 },     ← relance > 1er contact > campagne, puis FIFO
        set:  { status: 'sending' }
    )
    SI aucune entry → sortir

    # Re-vérification tardive : l'état a pu changer depuis l'enfilement
    SI company_meta.paused OU bounce hard :
        entry.status = 'cancelled'
        continuer SANS consommer le quota

    envoyer SMTP (texte brut)                     → messageId
    APPEND IMAP dans le dossier « Posty »         (§7)
    SI kind == 'sequence' :
        Twenty.PATCH {
          toContact: false,
          followupCount: step + 1,
          lastContactedAt: today,
          nextFollowupAt:  today + settings.sequence.delays[step],
          lastMessageId:   messageId,
          messageReferences: references + " " + messageId
        }
    écrire mail_log
    entry.status = 'sent'
    restant--

    dormir(aléatoire entre jitter.minSeconds et jitter.maxSeconds)
```

### 6.3 Le quota — le point le plus sensible du module
**25 envois par jour d'envoi, tous types confondus**, avec la priorité `relances > premiers contacts > campagne`.

> ⚠️ **Changement de sémantique par rapport à l'existant, assumé.** Aujourd'hui les relances sont **illimitées** et seuls les nouveaux sont plafonnés à 15. Avec un plafond global, une grosse vague de relances peut consommer toute la bande passante et repousser les premiers contacts au créneau suivant. C'est cohérent — une relance est plus légitime qu'un cold mail — mais l'UI doit **le montrer** : le dashboard affiche « 25/25 · dont 18 relances, 7 premiers contacts, 0 campagne — 34 en attente au prochain créneau ».

Le décompte se fait sur `mail_log` à la date du jour : **une double exécution du job ne double pas les envois.**

### 6.4 Les campagnes
**Cibles** : `PROSPECT` avec `followupCount >= 3` **ou** `CLIENT`. Jamais de `PARTENAIRE`.
**Sélection manuelle** : liste filtrable dans l'UI, cases à cocher. Sont **exclus automatiquement et de façon non contournable** : les `paused`, les `hard bounce`, les `isAutoHandled = false`, et ceux qui ont **déjà reçu cette campagne**.

**Composition :**
```
[ salutation automatique ]     ← verrouillée, générée par contact
[ corps rédigé à la main   ]   ← identique pour tous
[ blocs rigides choisis    ]   ← signature, footer… depuis mail_blocks
```
Format **texte brut**, comme le reste. Pas de HTML, pas de pixel de suivi, pas de lien raccourci (§10).

**Aperçu obligatoire** avant mise en file : le rendu final pour 3 destinataires tirés au hasard, avec leurs vraies salutations.

**« Mettre en file »** → crée N entrées `mail_queue` en `priority: 3`. Elles s'écoulent au rythme du quota, sur les mêmes créneaux, derrière la séquence auto. Une campagne de 60 contacts met donc quelques semaines à partir — **c'est le comportement voulu**, c'est ce qui protège ton domaine.

**Suivi** : envoyés / en file / annulés, et la date estimée de fin au rythme actuel.

### 6.5 Threading
- **Séquence** : les relances 1 et 2 se greffent sur le fil du premier contact (`In-Reply-To` + `References`). Comportement actuel, conservé.
- **Campagne** : **nouveau fil, nouveau sujet.** Aucun `In-Reply-To`. Ressusciter un fil que le destinataire a déjà ignoré trois fois enterre le message sous une vieille conversation, avec un sujet qu'il a déjà écarté. Une campagne est une nouvelle proposition : elle mérite un nouveau message.

---

## 7. IMAP — archivage

Bibliothèque : **`imapflow`**.

### 7.1 Archivage
Après chaque envoi réussi, `APPEND` du message MIME complet dans le dossier **`Posty`**, avec le flag `\Seen`. Le dossier est créé au démarrage s'il n'existe pas.

### 7.2 Règle d'idempotence — critique
**Si l'`APPEND` échoue, le mail est déjà parti.** On logue (`imapArchived: false`), on notifie, et **on ne renvoie jamais**. Un échec d'archivage n'est pas un échec d'envoi. Cette règle est un critère d'acceptation.

### 7.3 Le BCC `logs@`
Conservé dans un premier temps, en filet, le temps de vérifier que l'archivage IMAP est fiable. Réglable (`bccLogs: null` pour le couper). À retirer une fois la confiance établie — c'est précisément le bricolage que tu voulais remplacer.

---

## 8. IMAP — bounces et réponses

Job quotidien, une seule connexion IMAP, deux traitements.

### 8.1 Bounces
Scanner les nouveaux messages de la boîte de réception à la recherche de rapports de non-remise (`Content-Type: multipart/report; report-type=delivery-status`), extraire l'adresse et le code d'état.

- **Hard bounce** (`5.x.x`) → `company_meta.bounce = { kind: 'hard' }` · **`Twenty.PATCH { isAutoHandled: false }`** — on réutilise ton kill-switch existant, pas besoin d'un nouveau champ · annuler toutes ses entrées de file · **Pushover**.
- **Soft bounce** (`4.x.x`) → incrémenter le compteur. **3 soft consécutifs → traité comme un hard.**

### 8.2 Réponses
Détecter un message entrant dont l'expéditeur correspond à l'email d'un contact connu, **ou** dont l'en-tête `References` / `In-Reply-To` contient un `messageId` émis par Posty.

- → `company_meta.paused = true`, `pausedReason: 'reply'`
- → **annuler ses entrées en attente dans la file**
- → **Pushover** : « 💬 {Organisme} a répondu »

**Aucun changement de statut automatique.** L'UI propose deux actions, et c'est toi qui tranches :
- « Passer en CLIENT dans Twenty » (le contact sort de la séquence, reste éligible aux campagnes)
- « Reprendre la séquence »

> C'est le garde-fou qui empêche le pire scénario : une relance qui part le jeudi vers quelqu'un qui a répondu le mercredi.

---

## 9. Notifications (Pushover — via `shared/`)

| Événement | Priorité | Message |
|---|---|---|
| 💬 Réponse reçue | 1 | {Organisme} a répondu — à traiter |
| 🚨 Hard bounce | 1 | {Organisme} — adresse morte, sorti de l'auto |
| 🚨 Échec SMTP après retries | 1 | Envoi échoué vers {Organisme} — {erreur} |
| ⚠️ Archivage IMAP échoué | 0 | Mail parti, non archivé — {Organisme} |
| ⚠️ Quota atteint, file non vide | 0 | 25/25 envoyés — {n} encore en attente |
| ✅ Créneau terminé | −1 | {n} mails envoyés · {m} restants en file |
| ✅ Campagne terminée | 0 | « {campagne} » : {n} envoyés, {m} annulés |

---

## 10. Réputation — ce qui protège réellement le domaine

À vérifier et à documenter, hors code mais dans le README :

- **SPF, DKIM, DMARC** correctement configurés sur `pierre-godino.com`. C'est la base ; sans DKIM, tout le reste est vain.
- **Texte brut**, jamais de HTML. C'est déjà le cas, ne pas y toucher.
- **Aucun pixel de suivi, aucun lien raccourci.** Ce sont deux signaux de spam classiques. Si l'envie de mesurer les ouvertures se présente : ne pas le faire.
- **Volume plafonné** : 25 × 2 jours = **50/semaine maximum**.
- **Jitter** entre les envois : jamais deux mails à la même seconde.
- **Arrêt immédiat** sur bounce et sur réponse.

**Désinscription : aucune, sur ta décision.** Pour mémoire, et sans être juriste : en prospection B2B la CNIL attend un moyen d'opposition. Une ligne « répondez-moi et je vous retire de ma liste » coûte zéro et protège surtout d'un signalement en spam, qui abîme bien davantage la réputation d'un expéditeur qu'une désinscription. Le mécanisme de pause sur réponse (§8.2) en tient partiellement lieu.

---

## 11. Interface

Sidebar → section **Mailing** (à côté de **LinkedIn**), même design system, mêmes tokens, mêmes icônes lucide.

### `/mailing` — Dashboard
- **La file d'envoi** : combien en attente, réparties par priorité (relances / premiers contacts / campagnes), avec la barre de quota du jour.
- Prochain créneau + estimation « à ce rythme, la file sera vide le {date} ».
- **Alertes en tête** : réponses à traiter, bounces récents. Ce sont les seules choses qui demandent une action humaine.
- État SMTP / IMAP / Twenty (✅ ou ❌ avec le message d'erreur).
- Arrêt d'urgence global (`settings.paused`) et bandeau `dryRun`.

### `/mailing/queue` — La file
Liste triée par ordre de départ réel (priorité, puis FIFO). Pour chaque entrée : destinataire, type, **le mail exact qui partira** (sujet + corps rendus). Actions : prévisualiser, annuler, remonter en tête.

### `/mailing/sequence` — La séquence automatique
Édition des 3 templates (sujet, corps, blocs), des délais (`+5 j / +9 j / +60 j`), des jours et heures d'envoi, du plafond, du jitter.
**Aperçu en direct** du rendu avec une salutation d'exemple.

### `/mailing/campaigns` — Les campagnes
Liste + création. Le compositeur : sujet, corps (texte brut, compteur), blocs à cocher, **aperçu sur 3 contacts réels**. Puis sélection des cibles (liste filtrable, exclusions affichées et verrouillées), puis « Mettre en file » avec récapitulatif : *« 47 contacts · ~2 par créneau après la séquence · fin estimée le 12 septembre »*.
Suivi d'une campagne en cours : envoyés / en file / annulés.

### `/mailing/contacts` — Vue sur Twenty
Lecture seule sur les companies (filtrable par statut, `followupCount`, éligibilité campagne), enrichie de l'état Posty : salutation (éditable), pause, bounce, historique d'envois. Lien « Ouvrir dans Twenty ».

### `/mailing/log` — Journal
Tous les envois : date, destinataire, type, sujet, statut SMTP, archivage IMAP, PATCH Twenty, erreur. Filtrable. L'outil de debug.

### `/mailing/settings`
SMTP · IMAP (hôte, dossier d'archivage) · Twenty (URL, test de connexion) · quota · jours et heures · jitter · BCC · `dryRun`.

---

## 12. Ordre de développement

**Lot M0 — Sécurité (immédiat).** Rotation du token Twenty. TLS devant l'instance. `.env`.

**Lot M1 — Socle Mailing.** Client Twenty (typé, header `Authorization`, testé), `company_meta`, `mail_settings`, cache des salutations (job + édition manuelle), CRUD blocs et templates (seedés avec l'existant à l'identique).

**Lot M2 — La file et l'envoi.** `mail_queue`, job d'éligibilité, job d'envoi, quota, jitter, SMTP, PATCH Twenty, `mail_log`, `dryRun`. **Recette complète en `dryRun` avant tout envoi réel.**

**Lot M3 — IMAP.** Archivage dans « Posty », bounces, détection des réponses, alertes Pushover.

**Lot M4 — Campagnes.** Compositeur, blocs, sélection des cibles, aperçu, mise en file, suivi.

**Lot M5 — Bascule.** Tourner Posty en `dryRun` **en parallèle** de n8n pendant un cycle complet (deux semaines, deux créneaux par semaine). Comparer les files : Posty doit vouloir envoyer exactement ce que n8n a envoyé. **Puis seulement, couper les deux workflows n8n.**

---

## 13. Critères d'acceptation

- [ ] Le token Twenty ne transite **jamais** en query string, et n'est présent nulle part dans le code.
- [ ] En `dryRun`, sur un cycle complet, Posty produit **la même file** que ce que n8n aurait envoyé.
- [ ] Un contact ne peut pas recevoir deux fois le même mail de séquence (l'index unique le garantit — test à écrire).
- [ ] Un contact ne peut pas recevoir deux fois la même campagne.
- [ ] Le plafond de 25/jour est respecté, **même si le job est exécuté deux fois** dans la journée.
- [ ] Les relances passent **avant** les premiers contacts, qui passent **avant** les campagnes.
- [ ] Un mail envoyé apparaît dans le dossier IMAP « Posty ».
- [ ] Un échec d'archivage IMAP **ne provoque pas** de renvoi du mail.
- [ ] Un hard bounce sort le contact de l'automatisation (`isAutoHandled = false` dans Twenty) et vide ses entrées de file.
- [ ] Une réponse déclenche une alerte Pushover, met le contact en pause et **annule ses envois en attente** — sans changer son statut.
- [ ] Une campagne part en **nouveau fil**, sans `In-Reply-To`.
- [ ] Les relances de séquence restent **threadées** sur le fil du premier contact.
- [ ] Je modifie le délai « +5 j » depuis l'UI, sans toucher au code, et le prochain enfilement en tient compte.
- [ ] Je modifie la signature depuis l'UI : elle s'applique à la séquence **et** aux campagnes.
- [ ] La salutation est calculée une seule fois par contact, éditable, et **aucun appel LLM n'a lieu pendant la boucle d'envoi**.
- [ ] `settings.paused = true` arrête tout, immédiatement.
- [ ] `modules/mailing` n'importe rien de `modules/linkedin` (test d'architecture).

---

## 14. Variables d'environnement (en plus de celles du module LinkedIn)

```env
# Twenty CRM
TWENTY_API_URL=https://crm.mondomaine.fr     # TLS, plus d'IP nue
TWENTY_API_KEY=                              # RÉGÉNÉRÉ — header Authorization uniquement

# SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=contact@pierre-godino.com

# IMAP
IMAP_HOST=
IMAP_PORT=993
IMAP_USER=
IMAP_PASS=
IMAP_ARCHIVE_FOLDER=Posty
```

---

## 15. Points ouverts

1. **Le jitter de l'existant** (`Math.floor(Math.random() * 60)`) ne précise pas son unité dans le JSON exporté : c'est la valeur par défaut du nœud n8n qui s'applique. Défaut retenu ici : **45 à 180 secondes** entre deux envois. À ajuster après le premier créneau réel.
2. **Relance des CLIENT à 60 jours** : aujourd'hui marquée, jamais envoyée (§5.3). Si tu la veux vraiment, ce sera une **campagne récurrente** — à spécifier plus tard, hors v1.
3. **Le BCC `logs@`** est conservé en filet, puis à retirer une fois l'archivage IMAP éprouvé.
4. **Dossier de spam** : le scan des bounces ne lit que la boîte de réception. Certains rapports de non-remise atterrissent en indésirables. À vérifier sur ton hébergeur mail, et à ajouter au scan si nécessaire.
