import { z } from "zod";
import { h } from "../h";
import { registerTemplate, type VisualTemplate } from "../registry";

// Couverture de carrousel : promesse chiffrée en gros, sous-titre, auteur.
const schema = z.object({
  title: z.string().min(1).max(55, "Titre : 55 caractères max"),
  subtitle: z.string().max(90, "Sous-titre : 90 caractères max").default("").optional(),
  badge: z.string().max(30, "Badge : 30 caractères max").default("").optional(),
});
type P = z.infer<typeof schema>;

const template: VisualTemplate<P> = {
  id: "cover",
  label: "Couverture de carrousel",
  kind: "slide",
  schema,
  promptHint:
    "cover : { title (≤55, contient IDÉALEMENT un chiffre), subtitle (opt., ≤90), badge (opt., ≤30) }. RÉSERVÉE à la slide 1 d'un carrousel.",
  render: (p, t) =>
    h(
      "div",
      {
        style: {
          width: 1200,
          height: 1200,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: t.colors.bg,
          padding: 100,
          fontFamily: t.fonts.sans,
          color: t.colors.fg,
        },
      },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        p.badge
          ? h(
              "div",
              {
                style: {
                  display: "flex",
                  alignSelf: "flex-start",
                  fontSize: 28,
                  fontFamily: t.fonts.mono,
                  background: t.colors.accent,
                  color: t.colors.accentFg,
                  padding: "12px 24px",
                  borderRadius: 8,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  marginBottom: 60,
                },
              },
              p.badge,
            )
          : null,
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 1.05,
              color: t.colors.fg,
              marginBottom: 30,
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
                  fontSize: 36,
                  color: t.colors.fgMuted,
                  lineHeight: 1.3,
                },
              },
              p.subtitle,
            )
          : null,
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: 24,
            fontFamily: t.fonts.mono,
            color: t.colors.fgMuted,
            letterSpacing: 2,
            textTransform: "uppercase",
          },
        },
        "swipe →",
      ),
    ),
};

registerTemplate(template);
export default template;
