export default function Page() {
  return <div data-db={process.env.NEXT_PUBLIC_DATABASE_URL}>Hello</div>;
}
