import React from 'react';
import { useMolecule } from '../context/MoleculeContext';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';

export default function ExplanationPanel({ mobileInline = false }: { mobileInline?: boolean }) {
  const { namingResult, showAnalysis } = useMolecule();

  if (!showAnalysis || !namingResult) {
    if (mobileInline) return null;
    return (
      <div className="flex-1 p-6 flex items-center justify-center text-muted-foreground border-l border-border bg-[#09090b]">
        <div className="text-center">
          <p className="text-lg">Draw a molecule and click Analyze</p>
          <p className="text-sm mt-2 opacity-50">Or load a preset from the toolbar</p>
        </div>
      </div>
    );
  }

  const content = (
    <>
      {!mobileInline && (
        <div className="p-6 border-b border-border">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">IUPAC Name</h2>
          <div className="font-mono text-2xl font-bold text-primary break-all">
            {namingResult.name}
          </div>
        </div>
      )}

      <div className={mobileInline ? 'p-4 space-y-3' : 'p-6 space-y-4'}>
        {namingResult.warnings.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              {namingResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </AlertDescription>
          </Alert>
        )}

        <h3 className={mobileInline ? 'text-sm font-semibold text-foreground' : 'text-lg font-semibold text-foreground mb-4'}>
          Derivation Steps
        </h3>

        {namingResult.explanation.map((step, i) => (
          <Card key={i} className="bg-transparent border-border">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-xs font-semibold">{i + 1}. {step.title}</CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-3 pt-0 text-xs text-muted-foreground">
              {step.detail}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );

  if (mobileInline) return <div className="bg-[#09090b]">{content}</div>;

  return (
    <div className="w-96 flex-shrink-0 border-l border-border bg-[#09090b] flex flex-col h-full overflow-y-auto">
      {content}
    </div>
  );
}
