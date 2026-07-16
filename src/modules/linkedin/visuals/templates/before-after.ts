import { z } from "zod";
import { h } from "../h";
import { registerTemplate, type VisualTemplate } from "../registry";

// 2 colonnes de code : moche → propre. Le format le plus efficace en formation.
// Limites : titre ≤ 55, chaque code ≤ 12 lignes × 40 col (deux colonnes plus étroites).
const codeCheck = (s: string) =>
  s.split(/\r?\n/).length <= 12 && s.split(/\r?\n/).every((l) => l.length <= 40);

const schema = z.object({
  title: z.string().min(1).max(55, "Titre : 55 caractères max"),
  before: z
    .string()
    .min(1)
    .refine(codeCheck, "before : 12 lignes max × 40 colonnes"),
  after: z
    .string()
    .min(1)
    .refine(codeCheck, "after : 12 lignes max × 40 colonnes"),
});
type P = z.infer<typeof schema>;

function column(t: import("@/modules/linkedin/design/tokens").DesignTokens, label: string, code: string, tone: "bad" | "good") {
  const color = tone === "bad" ? t.colors.failed : t.colors.published;
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        background: t.colors.surface,
        border: `2px solid ${color}`,
        borderRadius: 16,
        padding: 30,
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          fontSize: 28,
          fontFamily: t.fonts.mono,
          color,
          marginBottom: 20,
          textTransform: "uppercase",
          letterSpacing: 2,
        },
      },
      label,
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: t.fonts.mono,
          fontSize: 24,
          lineHeight: 1.4,
          color: t.colors.fg,
          whiteSpace: "pre",
        },
      },
      code,
    ),
  );
}

const template: VisualTemplate<P> = {
  id: "before-after",
  label: "Avant / Après (code)",
  kind: "post",
  schema,
  promptHint:
    "before-after : { title (≤55), before (code moche, ≤12 lignes × ≤40 col), after (code propre, ≤12 lignes × ≤40 col) }. Le plus percutant pour un tip pédagogique.",
  render: (p, t) =>
    h(
      "div",
      {
        style: {
          width: 1200,
          height: 1200,
          display: "flex",
          flexDirection: "column",
          background: t.colors.bg,
          padding: 80,
          fontFamily: t.fonts.sans,
          color: t.colors.fg,
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 54,
            fontWeight: 700,
            marginBottom: 40,
            lineHeight: 1.1,
          },
        },
        p.title,
      ),
      h(
        "div",
        {
          style: { display: "flex", gap: 24, flexGrow: 1 },
        },
        column(t, "avant", p.before, "bad"),
        column(t, "après", p.after, "good"),
      ),
    ),
};

registerTemplate(template);
export default template;
