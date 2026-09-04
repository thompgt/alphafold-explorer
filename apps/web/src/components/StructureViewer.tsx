import { useEffect, useRef, useState } from 'react';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context';
import 'molstar/lib/mol-plugin-ui/skin/dark.scss';

/**
 * Mol* viewer for one AlphaFold model.
 *
 * Colouring uses Mol*'s own `plddt-confidence` theme, which reads the
 * `_ma_qa_metric_local` category AlphaFold writes into the mmCIF — the same numbers
 * the confidence track below is drawn from, so the two always agree.
 */
export function StructureViewer({ accession, url }: { accession: string; url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginUIContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const target = container.current;
        if (!target) return;

        const plugin =
          pluginRef.current ??
          (await createPluginUI({
            target,
            render: renderReact18,
            spec: {
              ...DefaultPluginUISpec(),
              layout: {
                initial: { isExpanded: false, showControls: false, controlsDisplay: 'reactive' },
              },
            },
          }));
        if (disposed) {
          plugin.dispose();
          return;
        }
        pluginRef.current = plugin;

        await plugin.clear();
        const data = await plugin.builders.data.download({ url, isBinary: false });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
        await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');

        // The theme only exists once an AlphaFold model is loaded, so failing to set
        // it is not fatal — the structure is still shown, just in default colours.
        try {
          await plugin.managers.structure.component.updateRepresentationsTheme(
            plugin.managers.structure.hierarchy.current.structures.flatMap((s) => s.components),
            { color: 'plddt-confidence' as never },
          );
        } catch {
          /* keep default colouring */
        }

        if (!disposed) setLoading(false);
      } catch (cause) {
        if (!disposed) {
          setError(String(cause));
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [url]);

  // Dispose only when the component actually goes away; re-creating the plugin on
  // every accession change leaks WebGL contexts and eventually kills the tab.
  useEffect(
    () => () => {
      pluginRef.current?.dispose();
      pluginRef.current = null;
    },
    [],
  );

  return (
    <div>
      <div className="viewer" ref={container} />
      {loading && <p className="muted">Loading {accession} into the viewer…</p>}
      {error && <p className="error">Could not render the structure: {error}</p>}
    </div>
  );
}
