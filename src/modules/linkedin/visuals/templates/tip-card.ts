import { z } from "zod";
import { h } from "../h";
import { registerTemplate, type VisualTemplate } from "../registry";

// Titre + 3 à 5 puces. Limites §9.2 : titre ≤ 55, puces ≤ 65 chacune.
const schema = z.object({
  title: z.string().min(1).max(55, "Titre : 55 caractères max"),
  subtitle: z.string().max(90, "Sous-titre : 90 caractères max").default("").optional(),
  bullets: z
    .array(z.string().min(1).max(65, "Puce : 65 caractères max"))
    .min(3, "3 puces minimum")
    .max(5, "5 puces maximum"),
});
type P = z.infer<typeof schema>;

const template: VisualTemplate<P> = {
  id: "tip-card",
  label: "Astuce (titre + puces)",
  kind: "both",
  schema,
  promptHint:
    "tip-card : { title (≤55), subtitle (opt., ≤90), bullets (3 à 5, chacune ≤65) }. Utilisable en post seul ou en slide de carrousel.",
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
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.1,
            marginBottom: p.subtitle ? 20 : 60,
            color: t.colors.fg,
          },
        },
        p.title,
      ),
      p.subtitle
        ? h(
            "div",
            {
              style: {
                display: "flex",
                fontSize: 30,
                color: t.colors.fgMuted,
                marginBottom: 60,
                lineHeight: 1.3,
              },
            },
            p.subtitle,
          )
        : null,
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 28 } },
        ...p.bullets.map((b) =>
          h(
            "div",
            {
              style: { display: "flex", alignItems: "flex-start", gap: 24 },
            },
            h(
              "div",
              {
                style: {
                  display: "flex",
                  width: 20,
                  height: 20,
                  marginTop: 18,
                  background: t.colors.accent,
                  borderRadius: 4,
                  flexShrink: 0,
                },
              },
            ),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  fontSize: 36,
                  lineHeight: 1.3,
                  color: t.colors.fg,
                  flexGrow: 1,
                },
              },
              b,
            ),
          ),
        ),
      ),
    ),
};

registerTemplate(template);
export default template;
