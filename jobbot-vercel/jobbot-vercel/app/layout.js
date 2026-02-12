import './globals.css';

export const metadata = {
  title: 'JobBot — AI Job Matching',
  description: 'Upload your resume, find matching jobs across 8+ sources, powered by AI',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
