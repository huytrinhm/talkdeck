/** Provisional ASR display; the host retains supersedable evidence separately for live drafting. */
export class TranscriptPreview {
  private items = new Map<string, { text: string; final: boolean }>();
  constructor(readonly id: string, readonly epoch: number, readonly slideId: string) {}
  event(event: { type?: string; item_id?: string; delta?: string; transcript?: string }) {
    if (!event.item_id) return false;
    const previous = this.items.get(event.item_id);
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.items.set(event.item_id, { text: event.transcript ?? '', final: true });
    } else if (event.type === 'conversation.item.input_audio_transcription.delta' && !previous?.final) {
      this.items.set(event.item_id, { text: (previous?.text ?? '') + (event.delta ?? ''), final: false });
    } else return false;
    return true;
  }
  snapshot() { return { id: this.id, epoch: this.epoch, slideId: this.slideId, text: [...this.items.values()].map(item => item.text).join(' ').trim() }; }
}
