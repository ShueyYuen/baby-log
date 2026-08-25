import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VisibilityPicker } from './visibility-picker';

vi.mock('../../lib/api', () => ({
  api: {
    members: {
      list: () =>
        Promise.resolve({
          data: [
            { id: 'u1', displayName: '妈妈' },
            { id: 'u2', displayName: '爸爸' },
          ],
        }),
    },
  },
}));

describe('VisibilityPicker', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('toggles members and clears restrictions', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<VisibilityPicker onChange={onChange} />);
    await user.click(screen.getByTitle('所有人可见'));
    expect(await screen.findByText('妈妈')).toBeInTheDocument();
    await user.click(screen.getByText('妈妈'));
    expect(onChange).toHaveBeenCalledWith(['u1']);

    rerender(<VisibilityPicker value={['u1']} onChange={onChange} />);
    await user.click(await screen.findByText('爸爸'));
    expect(onChange).toHaveBeenCalledWith(['u1', 'u2']);

    rerender(<VisibilityPicker value={['u1']} onChange={onChange} />);
    await user.click(await screen.findByText('清除限制'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
