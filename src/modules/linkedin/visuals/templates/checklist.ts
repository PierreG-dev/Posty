import { z } from "zod";
import { h } from "../h";
import { registerTemplate, type VisualTemplate } from "../registry";

// Liste à cocher — « les 5 erreurs qui font rater… ».
const schema = z.object({
  title: z.string().min(1).max(55, "Titre : 55 caractères max"),
  items: z
    .array(z.string().min(1).max(65, "Item : 65 caractères max"))
    .min(3, "3 items minimum")
    .max(5, "5 items maximum"),
});
type P = z.infer<typeof schema>;

const template: VisualTemplate<P> = {
  id: "checklist",
  label: "Checklist",
  kind: "post",
  schema,
  promptHint:
    "checklist : { title (≤55), items (3 à 5, chacun ≤65) }. Format « les N choses à vérifier / éviter ».",
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
            fontSize: 60,
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: 60,
            color: t.colors.fg,
          },
        },
        p.title,
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 32 } },
        ...p.items.map((it) =>
          h(
            "div",
            {
              style: { display: "flex", alignItems: "center", gap: 32 },
            },
            h(
              "div",
              {
                style: {
                  display: "flex",
                  width: 48,
                  height: 48,
                  border: `4px solid ${t.colors.accent}`,
                  borderRadius: 10,
                  background: t.colors.surface,
                  flexShrink: 0,
                },
              },
            ),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  fontSize: 38,
                  lineHeight: 1.3,
                  color: t.colors.fg,
                  flexGrow: 1,
                },
              },
              it,
            ),
          ),
        ),
      ),
    ),
};

registerTemplate(template);
export default template;
