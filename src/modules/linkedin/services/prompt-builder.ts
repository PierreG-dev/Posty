import type { Theme } from "@/modules/linkedin/domain/theme";
import type { Post } from "@/modules/linkedin/domain/post";
import { deriveTargetLength } from "@/modules/linkedin/domain/length-policy";
import { POST_LINE1_MAX, ALT_TEXT_MAX } from "@/modules/linkedin/domain/post";
import type { VisualRegistry } from "@/modules/linkedin/visuals/registry";
import "@/modules/linkedin/visuals/register";

// CDC-01 §8 — construction des prompts.
// Toutes ces fonctions sont PURES : testables sans DB, sans réseau, sans Anthropic.

// Version du prompt — bumper à chaque changement de format. Persisté dans
// `aiMeta.promptVersion` pour tracer la provenance des posts.
export const PROMPT_VERSION = "v1-lot5";

// CDC-01 §8.5 — contexte fixe injecté dans chaque `system`.
const CONTEXT_FIXE = [
  "Tu écris pour Pierre, formateur freelance en développement web.",
  "Il intervient sur les titres CDA et DWWM, en distanciel.",
  "Public : développeurs juniors, personnes en reconversion, autres formateurs, recruteurs tech.",
  "Ton : praticien qui enseigne, pas gourou qui sermonne. Le « je » est souhaitable.",
  "Une anecdote de session vaut mieux que dix généralités.",
].join(" ");

// §8.5 règle dure — MOT POUR MOT. Un test vérifie que cette chaîne exacte figure
// dans le system prompt.
export const LOCALIZATION_RULE =
  "Règle dure, non négociable : ne jamais mentionner ni suggérer de localisation géographique, de ville, de pays, de fuseau horaire, de décalage horaire, de voyage ou d'expatriation. Aucun marqueur temporel local (« ce matin il faisait… », « ici il est déjà… »).";

// §8.4 — patterns de hook, avec exemples.
const HOOK_DESCRIPTIONS: Record<string, string> = {
  aveu: "aveu — ex : « J'ai mis trois ans à comprendre que… »",
  chiffre: "chiffre — un chiffre contre-intuitif, ex : « 8 candidats sur 10 échouent sur… »",
  "erreur-commune": "erreur-commune — ex : « Ton code marche. C'est exactement le problème. »",
  "question-fermee": "question-fermee — ex : « Tu sais ce qui fait rater une soutenance DWWM ? »",
};

const HOOK_FORBIDDEN = [
  'Interdits explicites pour le hook :',
  '- annonce de sommaire (« Voici 5 astuces 👇 »)',
  '- « Spoiler : … »',
  '- « Et devinez quoi ? »',
].join("\n");

/**
 * §8.5 — system prompt : contexte fixe + règle dure + posture thème + patterns
 * de hook autorisés + interdits + hints du registry visuel.
 */
export function buildSystemPrompt(theme: Theme, registry: VisualRegistry): string {
  const patterns = theme.ai.hookPatterns.length > 0
    ? theme.ai.hookPatterns.map((p) => `- ${HOOK_DESCRIPTIONS[p] ?? p}`).join("\n")
    : "- (aucun pattern imposé — choisis librement dans les 4 patterns : aveu, chiffre, erreur-commune, question-fermee)";

  const parts = [
    CONTEXT_FIXE,
    "",
    LOCALIZATION_RULE,
    "",
    "— Consignes propres à ce thème —",
    theme.ai.systemPrompt.trim() || "(aucune consigne spécifique)",
    theme.ai.structure.trim() ? `\nStructure attendue : ${theme.ai.structure.trim()}` : "",
    "",
    `Le hook (première ligne, ≤ ${POST_LINE1_MAX} caractères) doit suivre l'un des patterns suivants :`,
    patterns,
    "",
    HOOK_FORBIDDEN,
    "",
    registry.promptHints(theme.visual.mode),
  ];
  return parts.filter((p) => p !== "").join("\n");
}

// §8.6 — anti-répétition : 10 derniers posts publiés, tronqués à 200 caractères.
const RECENT_TRUNC = 200;
const RECENT_MAX = 10;

function formatRecent(recent: Post[]): string {
  if (recent.length === 0) {
    return "Aucun post récent sur ce thème.";
  }
  const items = recent.slice(0, RECENT_MAX).map((p, i) => {
    const excerpt = p.content.length > RECENT_TRUNC
      ? p.content.slice(0, RECENT_TRUNC) + "…"
      : p.content;
    return `[${i + 1}] ${excerpt}`;
  });
  return [
    `Les ${items.length} derniers posts publiés sur ce thème :`,
    items.join("\n\n"),
    "",
    "Ne reprends aucun de ces angles. Propose un sujet différent.",
  ].join("\n");
}

function formatExamples(theme: Theme): string {
  if (theme.ai.examples.length === 0) return "";
  const items = theme.ai.examples.map((e, i) => `— Exemple ${i + 1} —\n${e}`).join("\n\n");
  return `Exemples de posts qui te servent de référence stylistique :\n\n${items}`;
}

function formatForbidden(theme: Theme): string {
  if (theme.ai.forbiddenPhrases.length === 0) return "";
  const items = theme.ai.forbiddenPhrases.map((p) => `- « ${p} »`).join("\n");
  return `Formulations à éviter absolument :\n${items}`;
}

/**
 * §8.7 — contrat JSON. Dérivé du registry pour les champs visual/carousel.
 * Renvoyé au modèle et copiable via « Copier le schéma » (§8.9).
 */
export function buildContractFragment(theme: Theme, registry: VisualRegistry): string {
  const range = deriveTargetLength(theme);
  const frag = registry.contractFragment(theme.visual.mode);
  return [
    "Contrat de sortie — JSON strict, sans préambule, sans backticks :",
    "{",
    `  "content": "…",                            // ${range.min} à ${range.max} caractères, première ligne ≤ ${POST_LINE1_MAX}`,
    `  "hashtags": ["#…", "#…"],                  // 3 à 5, format #MotSansEspace`,
    `  "firstComment": "…" | null,                // les liens (http/https) vont ICI, jamais dans content`,
    `  ${frag.visual},`,
    `  ${frag.carousel},`,
    `  "altText": "≤ ${ALT_TEXT_MAX} caractères"`,
    "}",
    "",
    "Interdits absolus dans `content` : markdown (**, #, - ), URL, mentions de lieu/temps/voyage.",
  ].join("\n");
}

/**
 * §8.6 — user prompt : consigne, exemples, anti-répétition, contrat JSON.
 */
export function buildUserPrompt(
  theme: Theme,
  recentPosts: Post[],
  registry: VisualRegistry,
): string {
  const parts = [
    `Génère un post LinkedIn pour le thème « ${theme.name} ».`,
    "",
    formatExamples(theme),
    "",
    formatForbidden(theme),
    "",
    formatRecent(recentPosts),
    "",
    buildContractFragment(theme, registry),
    "",
    "Réponds uniquement par le JSON, sans préambule, sans backticks.",
  ];
  return parts.filter((p) => p !== "").join("\n\n");
}

/**
 * §8.9 — prompt AUTONOME, copiable, prêt à coller dans n'importe quel LLM.
 * Contient : contexte fixe + règle dure + consignes thème + exemples + 10
 * derniers + contrat + consigne finale.
 */
export function buildStandalonePrompt(
  theme: Theme,
  recentPosts: Post[],
  registry: VisualRegistry,
): string {
  return [
    buildSystemPrompt(theme, registry),
    "",
    "═════════════════════════════════════════════",
    "",
    buildUserPrompt(theme, recentPosts, registry),
  ].join("\n");
}
