import { fireEvent, render } from '@testing-library/react-native';
import { AttachmentThumb } from '../AttachmentThumb';

const att = {
  id: 'a', kind: 'bill_receipt' as const, content_type: 'image/jpeg', size_bytes: 10, url: 'https://x/y', url_expires_at: '2026-10-05T00:00:00Z',
};

it('asks for a refresh once when the image fails to load', async () => {
  const onExpired = jest.fn();
  const { getByTestId } = await render(<AttachmentThumb attachment={att} onExpired={onExpired} />);
  await fireEvent(getByTestId('attachment-image'), 'error');
  await fireEvent(getByTestId('attachment-image'), 'error');
  expect(onExpired).toHaveBeenCalledTimes(1);
});

it('renders a document tile for PDFs', async () => {
  const { getByLabelText } = await render(<AttachmentThumb attachment={{ ...att, content_type: 'application/pdf' }} />);
  expect(getByLabelText('PDF document, 10 bytes')).toBeTruthy();
});
