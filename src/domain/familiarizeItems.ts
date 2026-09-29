import {
  parseArticleOccurrenceId,
  parseTaskItemId,
} from "./assignment";
import { portionKey } from "./chapters";
import { familiarizeContentId } from "./familiarizeCache";
import type { Article, InventoryDoc, Portion } from "./types";

export type FamiliarizeHelpResource =
  | "academia"
  | "palabras"
  | "notas"
  | "preguntas"
  | "fuente";

export type FamiliarizeHelpItem = {
  id: string;
  resource: FamiliarizeHelpResource;
  label: string;
  articleId?: string;
  path?: string;
};

const RESOURCE_LABEL: Record<FamiliarizeHelpResource, string> = {
  academia: "Academia",
  palabras: "Palabras",
  notas: "Notas",
  preguntas: "Preguntas",
  fuente: "Fuente",
};

export function familiarizeResourceLabel(resource: FamiliarizeHelpResource): string {
  return RESOURCE_LABEL[resource];
}

function matchPortion(inventory: InventoryDoc, portionId: string): Portion | undefined {
  return inventory.portions.find(
    (p) => portionKey(p) === portionId || p.ref === portionId || p.id === portionId,
  );
}

function lookupArticle(inventory: InventoryDoc, articleId: string): Article | undefined {
  const needle = articleId.trim().toLowerCase();
  return inventory.articles.find(
    (a) =>
      a.id.toLowerCase() === needle ||
      a.path.toLowerCase() === needle ||
      a.path.toLowerCase().endsWith(`/${needle}`),
  );
}

function articleItem(
  resource: "academia" | "palabras",
  articleId: string,
  inventory: InventoryDoc | null,
): FamiliarizeHelpItem {
  const article = inventory ? lookupArticle(inventory, articleId) : undefined;
  const path = article?.path || "";
  return {
    id: familiarizeContentId({
      resource,
      articleId: article?.id || articleId,
      path,
    }),
    resource,
    label: article?.title?.trim() || article?.id || articleId,
    articleId: article?.id || articleId,
    path: path || undefined,
  };
}

function pushUnique(out: FamiliarizeHelpItem[], item: FamiliarizeHelpItem): void {
  if (out.some((row) => row.id === item.id)) return;
  out.push(item);
}

/** Help / article items for this launch (not the scripture verses themselves). */
export function collectFamiliarizeHelpItems(
  ctx: {
    book: string;
    ref: string;
    resource: string;
    portionIds: string[];
    itemIds: string[];
  },
  inventory: InventoryDoc | null,
): FamiliarizeHelpItem[] {
  const out: FamiliarizeHelpItem[] = [];
  const portions: Portion[] = [];
  if (inventory) {
    for (const id of ctx.portionIds) {
      const portion = matchPortion(inventory, id);
      if (portion) portions.push(portion);
    }
  }

  for (const portion of portions) {
    for (const ref of portion.academia ?? []) {
      pushUnique(out, articleItem("academia", ref.id, inventory));
    }
    for (const ref of portion.palabras ?? []) {
      pushUnique(out, articleItem("palabras", ref.id, inventory));
    }
    if (ctx.resource === "notas") {
      for (const task of portion.notasItems ?? []) {
        pushUnique(out, {
          id: familiarizeContentId({ resource: "notas", articleId: task.id }),
          resource: "notas",
          label: task.ref || task.id,
          articleId: task.id,
        });
      }
    }
    if (ctx.resource === "preguntas") {
      for (const task of portion.preguntasItems ?? []) {
        pushUnique(out, {
          id: familiarizeContentId({ resource: "preguntas", articleId: task.id }),
          resource: "preguntas",
          label: task.ref || task.id,
          articleId: task.id,
        });
      }
    }
  }

  for (const raw of ctx.itemIds) {
    const occ = parseArticleOccurrenceId(raw);
    if (occ) {
      const resource =
        ctx.resource === "academia" || ctx.resource === "palabras"
          ? ctx.resource
          : "palabras";
      pushUnique(out, articleItem(resource, occ.articleId, inventory));
      continue;
    }
    const task = parseTaskItemId(raw);
    if (task && (task.resource === "notas" || task.resource === "preguntas")) {
      pushUnique(out, {
        id: familiarizeContentId({ resource: task.resource, articleId: task.id }),
        resource: task.resource,
        label: task.id,
        articleId: task.id,
      });
    }
  }

  return out;
}

export function fuenteItem(ctx: { book: string; ref: string }): FamiliarizeHelpItem {
  const ref = ctx.ref.trim() || ctx.book;
  return {
    id: familiarizeContentId({
      resource: "fuente",
      articleId: `${ctx.book}:${ref}`,
    }),
    resource: "fuente",
    label: ctx.book ? `${ctx.book} ${ref}` : ref,
  };
}
