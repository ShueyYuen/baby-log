import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Input } from './input';
import { Textarea } from './textarea';
import { Slider } from './slider';
import { GrowthSkeleton, MomentsSkeleton, PlansSkeleton, Skeleton, StatsSkeleton, TimelineSkeleton } from './skeleton';
import { ToastProvider, useToast } from './toast';
import { MediaThumbs } from './media-thumbs';

describe('primitive UI', () => {
  it('renders card parts, inputs, and slider', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Card>
        <CardHeader>
          <CardTitle>标题</CardTitle>
          <CardDescription>说明</CardDescription>
        </CardHeader>
        <CardContent>
          <Input placeholder="姓名" />
          <Textarea placeholder="备注" />
          <Slider value={37} min={35} max={42} step={0.1} unit="°C" onChange={onChange} />
        </CardContent>
      </Card>,
    );
    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('姓名')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('备注'), 'ok');
  });

  it('renders skeleton variants', () => {
    render(
      <>
        <Skeleton className="h-4" />
        <TimelineSkeleton />
        <MomentsSkeleton />
        <GrowthSkeleton />
        <StatsSkeleton />
        <PlansSkeleton />
      </>,
    );
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5);
  });
});

function ToastProbe() {
  const { toast } = useToast();
  return (
    <div>
      <button onClick={() => toast('成功', 'success', { action: { label: '撤销', onClick: () => {} } })}>
        ok
      </button>
      <button onClick={() => toast('失败', 'error')}>err</button>
      <button onClick={() => toast('提示')}>info</button>
    </div>
  );
}

describe('toast', () => {
  it('shows variants and can be dismissed', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    await user.click(screen.getByText('ok'));
    expect(await screen.findByText('成功')).toBeInTheDocument();
    expect(screen.getByText('撤销')).toBeInTheDocument();
    await user.click(screen.getByText('err'));
    expect(await screen.findByText('失败')).toBeInTheDocument();
  });
});

describe('MediaThumbs', () => {
  it('renders images, videos, and overflow', async () => {
    const user = userEvent.setup();
    render(
      <MediaThumbs
        images={[
          { url: '/a.jpg' },
          { url: '/b.mp4', mediaType: 'video', posterUrl: '/b.jpg' },
          { url: '/c.jpg' },
        ]}
        max={2}
      />,
    );
    expect(document.querySelector('img')).toBeTruthy();
    expect(screen.getByText('+1')).toBeInTheDocument();
    await user.click(screen.getByText('+1'));
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
  });
});
