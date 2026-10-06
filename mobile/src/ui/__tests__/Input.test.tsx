import { fireEvent, render } from '@testing-library/react-native';
import { Input } from '../Input';

it('toggles a password field between hidden and shown', async () => {
  const { getByLabelText } = await render(<Input label="Password" value="hunter22" secureToggle />);
  const field = getByLabelText('Password');
  expect(field.props.secureTextEntry).toBe(true);
  await fireEvent.press(getByLabelText('Show password'));
  expect(getByLabelText('Password').props.secureTextEntry).toBe(false);
  await fireEvent.press(getByLabelText('Hide password'));
  expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
});

it('has no toggle on ordinary fields', async () => {
  const { queryByLabelText } = await render(<Input label="Email" value="a@b.c" />);
  expect(queryByLabelText('Show password')).toBeNull();
});
