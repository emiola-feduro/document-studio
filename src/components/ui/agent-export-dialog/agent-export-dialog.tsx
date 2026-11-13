import useAgentExport, { TARGET_SUGGESTIONS, type AgentFormat, type AgentScope } from '../../../hooks/data/use-agent-export';
import useT from '../../../hooks/ui/use-t';
import Button from '../button/button';
import Checkbox from '../checkbox/checkbox';
import Modal from '../modal/modal';
import SegmentedControl from '../segmented-control/segmented-control';

/** Exports the model as Markdown or JSON for a coding agent, optionally aimed at a library. */
const AgentExportDialog = () => {
  const t = useT();
  const { open, close, collections, fields, canCopy, download, copy } = useAgentExport();
  const { format, setFormat, scope, setScope, collectionId, setCollectionId, target, setTarget, notes, setNotes, includeScript, setIncludeScript } = fields;

  return (
    <Modal
      title={t('agentExport.dialogTitle')}
      open={open}
      onClose={close}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={() => void copy()} disabled={!canCopy} title={canCopy ? undefined : t('agentExport.copyZipHint')}>
            {t('agentExport.copy')}
          </Button>
          <Button variant="primary" onClick={() => void download()}>
            {t('agentExport.download')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="block font-medium">{t('agentExport.format')}</span>
          <SegmentedControl<AgentFormat> label={t('agentExport.format')} value={format} onChange={setFormat} options={[{ value: 'markdown', label: 'Markdown' }, { value: 'json', label: 'JSON' }]} />
        </div>
        <div className="space-y-1.5">
          <span className="block font-medium">{t('agentExport.scope')}</span>
          <SegmentedControl<AgentScope>
            label={t('agentExport.scope')}
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: t('agentExport.scopeAll') },
              { value: 'collection', label: t('agentExport.scopeCollection') },
              { value: 'perCollection', label: t('agentExport.scopePerCollection') },
            ]}
          />
        </div>
        {scope === 'collection' && (
          <div className="space-y-1.5">
            <label htmlFor="agent-collection" className="block font-medium">
              {t('agentExport.collection')}
            </label>
            <select id="agent-collection" className="field" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="agent-target" className="block font-medium">
            {t('agentExport.target')}
          </label>
          <input id="agent-target" className="field" list="agent-target-suggestions" placeholder={t('agentExport.targetPlaceholder')} value={target} onChange={(e) => setTarget(e.target.value)} />
          <datalist id="agent-target-suggestions">
            {TARGET_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="agent-notes" className="block font-medium">
            {t('agentExport.notesLabel')}
          </label>
          <textarea id="agent-notes" className="field min-h-20 resize-y" placeholder={t('agentExport.notesPlaceholder')} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Checkbox label={t('agentExport.includeScript')} checked={includeScript} onChange={setIncludeScript} />
      </div>
    </Modal>
  );
};

export default AgentExportDialog;
