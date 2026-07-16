import { z } from "zod";
import { h } from "../h";
import { registerTemplate, type VisualTemplate } from "../registry";

// Snippet coloré, JetBrains Mono, fond encre, accent ambre.
// Limites §9.2 : titre ≤ 55, code ≤ 14 lignes × 60 col.
const schema = z.object({
  title: z.string().min(1).max(55, "Titre : 55 caractères max"),
  language: z.string().max(20).default("").optional(),
  code: z
    .string()
    .min(1)
    .refine((s) => s.split(/\r?\n/).length <= 14, "Code : 14 lignes max")
    .refine(
      (s) => s.split(/\r?\n/).every((l) => l.length <= 60),
      "Code : 60 colonnes max par ligne",
    ),
});
type P = z.infer<typeof schema>;

const template: VisualTemplate<P> = {
  id: "code-card",
  label: "Snippet de code",
  kind: "post",
  schema,
  promptHint:
    "code-card : { title (≤55), language (opt., ≤20), code (≤14 lignes × ≤60 col) }. Idéal pour illustrer un pattern, un bug avant/après une correction, une API récente.",
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
            fontSize: 30,
            color: t.colors.fgMuted,
            fontFamily: t.fonts.mono,
            marginBottom: 20,
          },
        },
        p.language || "code",
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 54,
            fontWeight: 700,
            marginBottom: 40,
            lineHeight: 1.1,
            color: t.colors.fg,
          },
        },
        p.title,
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            background: t.colors.surface,
            border: `2px solid ${t.colors.accent}`,
            borderRadius: 16,
            padding: 40,
            fontFamily: t.fonts.mono,
            fontSize: 30,
            lineHeight: 1.4,
            color: t.colors.fg,
            whiteSpace: "pre",
            flexGrow: 1,
          },
        },
        p.code,
      ),
    ),
};

registerTemplate(template);
export default template;
