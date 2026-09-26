import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Original color-and-shape clips. No family media, stock footage, or network input.
const clips = [
  ['demo-colors-01', '0x643f5c', '0xf18b68'],
  ['demo-shapes-02', '0x235765', '0x75bfad'],
  ['demo-stars-03', '0x2f315e', '0x9693e5'],
  ['demo-numbers-04', '0x6a4b33', '0xe4b66b'],
];

function run(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with status ${result.status}`);
}

mkdirSync('demo/public/media', { recursive: true });
mkdirSync('demo/public/thumbnails', { recursive: true });

for (const [id, background, accent] of clips) {
  const media = `demo/public/media/${id}.mp4`;
  const thumbnail = `demo/public/thumbnails/${id}.jpg`;
  const filter = [
    `drawbox=x=75:y=70:w=810:h=400:color=${accent}@0.22:t=fill`,
    `drawbox=x=110:y=110:w=130:h=130:color=${accent}:t=fill`,
    `drawbox=x=320:y=160:w=280:h=280:color=${accent}@0.58:t=fill`,
    `drawbox=x=720:y=300:w=100:h=100:color=${accent}:t=fill`,
    'fade=t=in:st=0:d=1',
    'fade=t=out:st=19:d=1',
  ].join(',');
  run([
    '-f', 'lavfi', '-i', `color=c=${background}:s=960x540:r=24:d=20`,
    '-vf', filter, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '29',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media,
  ]);
  run(['-ss', '1', '-i', media, '-frames:v', '1', '-q:v', '3', thumbnail]);
  process.stdout.write(`Generated ${id}\n`);
}
