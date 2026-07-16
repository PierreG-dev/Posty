import { z } from "zod";
import { h } from "../h";
import { registerTemplate, type VisualTemplate } from "../registry";

// Clôture de carrousel — CTA net.
const schema = z.object({
  headline: z.string().min(1).max(55, "Headline : 55 caractères max"),
  action: z.string().min(1).max(65, "Action : 65 caractères max"),
  footer: z.string().max(60, "Footer : 60 caractères max").default("").optional(),
});
type P = z.infer<typeof schema>;

const template: VisualTemplate<P> = {
  id: "cta",
  label: "CTA (fin de carrousel)",
  kind: "slide",
  schema,
  promptHint:
    "cta : { headline (≤55), action (≤65, verbe à l'impératif), footer (opt., ≤60) }. RÉSERVÉE à la DERNIÈRE slide d'un carrousel.",
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
          padding: 100,
          fontFamily: t.fonts.sans,
          color: t.colors.fg,
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.1,
            textAlign: "center",
            color: t.colors.fg,
            marginBottom: 60,
          },
        },
        p.headline,
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            fontSize: 42,
            fontWeight: 700,
            background: t.colors.accent,
            color: t.colors.accentFg,
            padding: "40px 60px",
            borderRadius: 20,
            marginBottom: 60,
          },
        },
        p.action,
      ),
      p.footer
        ? h(
            "div",
            {
              style: {
                display: "flex",
                fontSize: 28,
                fontFamily: t.fonts.mono,
                color: t.colors.fgMuted,
                textAlign: "center",
              },
            },
            p.footer,
          )
        : null,
    ),
};

registerTemplate(template);
export default template;
