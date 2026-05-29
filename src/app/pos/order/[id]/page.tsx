// Active order view — owner: Mine (task M6)
// "Done" button must be the most visually dominant action (rule L15).

export default function ActiveOrderPage({ params }: { params: { id: string } }) {
  return (
    <main>
      {/* TODO (M6): ActiveOrder component — order detail + Done button (rule L15) */}
      <p>Active order {params.id} (task M6)</p>
    </main>
  );
}
