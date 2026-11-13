import type { ReactNode } from 'react';
import useT from '../../../hooks/ui/use-t';
import Button from '../button/button';
import Modal from '../modal/modal';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra controls under the message, such as an option of the action. */
  children?: ReactNode;
};

const ConfirmDialog = ({ open, title, message, confirmLabel, onConfirm, onCancel, children }: ConfirmDialogProps) => {
  const t = useT();
  return (
    <Modal
      title={title}
      open={open}
      onClose={onCancel}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" className="bg-danger! border-danger! text-white!" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="leading-relaxed">{message}</p>
      {children && <div className="mt-3">{children}</div>}
    </Modal>
  );
};

export default ConfirmDialog;
