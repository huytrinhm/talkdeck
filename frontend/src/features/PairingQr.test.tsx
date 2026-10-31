// @vitest-environment jsdom
import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {PairingQr} from './PairingQr';
afterEach(cleanup);
it('never draws a scannable login code without a service-issued HTTPS offer',()=>{render(<PairingQr/>);expect(screen.queryByRole('img',{name:'Phone pairing QR code'})).toBeNull();expect(screen.getByText('Pairing QR unavailable')).toBeTruthy()});
it('renders an actual locally encoded QR for a service-issued HTTPS offer',async()=>{render(<PairingQr url="https://talkdeck.example/pair/test-fixture"/>);expect(await screen.findByRole('img',{name:'Phone pairing QR code'})).toBeTruthy()});
it('rejects unsafe QR schemes',()=>{render(<PairingQr url="javascript:alert(1)"/>);expect(screen.queryByRole('img')).toBeNull();expect(screen.getByText('Pairing QR unavailable')).toBeTruthy()});
