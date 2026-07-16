import { z } from "zod";
import { h } from "../h";
import { registerTemplate, type VisualTemplate } from "../registry";

// Citation / punchline centrée. Limite §9.2 : ≤ 160.
const schema = z.object({
  text: z.string().min(1).max(160, "Citation : 160 caractères max"),
  author: z.string().max(60, "Auteur : 60 caractères max").default("").optional(),
});
type P = z.infer<typeof schema>;

const template: VisualTemplate<P> = {
  id: "quote",
  label: "Citation",
  kind: "both",
  schema,
  promptHint:
    "quote : { text (≤160), author (opt., ≤60) }. Pour une punchline nette. Utilisable en post seul ou en slide.",
  render: (p, t) =>
    h(
      "div",
      {
        style: {
          width: 1200,
          height: 1200,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: t.colors.bg,
          padding: 120,
          fontFamily: t.fonts.sans,
          color: t.colors.fg,
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 140,
            color: t.colors.accent,
            fontFamily: t.fonts.sans,
            marginBottom: -20,
            lineHeight: 1,
          },
        },
        "«",
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.25,
            textAlign: "center",
            color: t.colors.fg,
            marginBottom: 40,
          },
        },
        p.text,
      ),
      p.author
        ? h(
            "div",
            {
              style: {
                display: "flex",
                fontSize: 28,
                fontFamily: t.fonts.mono,
                color: t.colors.fgMuted,
                letterSpacing: 2,
                textTransform: "uppercase",
              },
            },
            `— ${p.author}`,
          )
        : null,
    ),
};

registerTemplate(template);
export default template;
