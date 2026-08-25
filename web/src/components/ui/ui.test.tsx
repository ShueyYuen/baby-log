import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

describe('Button', () => {
  it('renders children and forwards clicks', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>保存</Button>);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when the disabled prop is set', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        提交
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: '提交' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('renders the given text', () => {
    render(<Badge variant="success">正常</Badge>);
    expect(screen.getByText('正常')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('confirms and cancels', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="删除记录"
        description="此操作不可撤销"
        confirmLabel="删除"
        variant="danger"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText('删除记录')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(onConfirm).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Dialog', () => {
  it('opens from a trigger', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <button type="button">打开</button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>标题</DialogTitle>
            <DialogDescription>说明文字</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByText('打开'));
    expect(await screen.findByText('标题')).toBeInTheDocument();
    expect(screen.getByText('说明文字')).toBeInTheDocument();
  });
});

describe('Select', () => {
  it('renders a trigger with a placeholder', () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项A</SelectItem>
          <SelectItem value="b">选项B</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText('请选择')).toBeInTheDocument();
  });
});
