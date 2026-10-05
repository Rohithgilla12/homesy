import { fireEvent, render } from '@testing-library/react-native';
import { CoverImage } from '../CoverImage';

it('asks for a refresh once when the cover fails to load', async () => {
  const onExpired = jest.fn();
  const { getByTestId } = await render(<CoverImage uri="https://x/cover" onExpired={onExpired} />);
  await fireEvent(getByTestId('cover-image'), 'error');
  await fireEvent(getByTestId('cover-image'), 'error');
  expect(onExpired).toHaveBeenCalledTimes(1);
});
