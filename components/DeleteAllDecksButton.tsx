'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteAllDecksButton() {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    try {
      setIsDeleting(true);
      const response = await fetch('/api/deck/delete-all', {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('We could not remove your learning spaces.');
      }

      // Refresh the page to show the changes
      router.refresh();
    } catch (error) {
      console.error('Error deleting decks:', error);
      alert('We could not remove your learning spaces.');
    } finally {
      setIsDeleting(false);
      setIsConfirming(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className={`px-4 py-2 rounded text-white transition-colors ${
        isConfirming
          ? 'bg-red-600 hover:bg-red-700'
          : 'bg-gray-600 hover:bg-gray-700'
      } disabled:opacity-50`}
    >
      {isDeleting
        ? 'Removing...'
        : isConfirming
        ? 'Click again to confirm removal'
        : 'Remove all study sets'}
    </button>
  );
}