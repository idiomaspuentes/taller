import { useState } from "react";
import type { DcsOrg } from "@ip-lms/dcs-client";
import { BOOKS, defaultContentOrg } from "../domain/books";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GtSession } from "../dcs/auth";

type Props = {
  lang: string;
  contentOrg: string;
  pmOrg: string;
  book: string;
  orgs: DcsOrg[];
  session: GtSession | null;
  onLangChange: (lang: string) => void;
  onContentOrgChange: (org: string) => void;
  onPmOrgChange: (org: string) => void;
  onBookChange: (book: string) => void;
  onContinue: () => void;
  onSignIn: () => void;
};

export function ContextView({
  lang,
  contentOrg,
  pmOrg,
  book,
  orgs,
  session,
  onLangChange,
  onContentOrgChange,
  onPmOrgChange,
  onBookChange,
  onContinue,
  onSignIn,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const valid = Boolean(lang.trim() && contentOrg.trim() && book.trim());
  const selectedBook = BOOKS.find((b) => b.code === book);
  const isCustomContentOrg = contentOrg !== defaultContentOrg(lang);
  const showContentOrg = advancedOpen || isCustomContentOrg;

  return (
    <Card className="mx-auto max-w-lg" size="sm">
      <CardHeader>
        <CardTitle>Contexto</CardTitle>
        <CardDescription>
          Elige lengua, organización de contenido y libro. La organización PM es opcional hasta
          iniciar sesión en DCS.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ctx-lang">Lengua</Label>
          <Input
            id="ctx-lang"
            value={lang}
            onChange={(e) => onLangChange(e.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {showContentOrg ? (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ctx-content">Organización de contenido</Label>
              {!isCustomContentOrg ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setAdvancedOpen(false)}
                >
                  Ocultar
                </button>
              ) : null}
            </div>
            <Input
              id="ctx-content"
              value={contentOrg}
              onChange={(e) => onContentOrgChange(e.target.value.trim())}
              title="Donde viven {lang}_ta y {lang}_tw"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Donde viven los recursos públicos (TPL, TPS, Notas, Palabras, Preguntas, Academia).
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setAdvancedOpen(true)}
          >
            Avanzado: organización de contenido ({contentOrg})
          </button>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="ctx-pm">Organización PM</Label>
          {session ? (
            <Select
              value={pmOrg || "__none__"}
              onValueChange={(v) => onPmOrgChange(v === "__none__" ? "" : v)}
            >
              <SelectTrigger id="ctx-pm" className="w-full" aria-label="Organización PM">
                <SelectValue placeholder="Opcional hasta DCS" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__none__">— opcional —</SelectItem>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.name}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input id="ctx-pm" value="" disabled placeholder="Requiere sesión DCS" />
              <Button type="button" variant="outline" size="sm" onClick={onSignIn}>
                Iniciar sesión
              </Button>
            </div>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ctx-book">Libro</Label>
          <Select value={book} onValueChange={onBookChange}>
            <SelectTrigger id="ctx-book" className="w-full" aria-label="Libro">
              <SelectValue>
                {selectedBook ? `${selectedBook.code} — ${selectedBook.name}` : book}
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              {BOOKS.map((b) => (
                <SelectItem key={b.code} value={b.code}>
                  {b.code} — {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" disabled={!valid} onClick={onContinue}>
          Continuar
        </Button>
      </CardFooter>
    </Card>
  );
}
