// @vitest-environment jsdom
import {afterEach,it,expect} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {Audience} from './Audience';
afterEach(cleanup);
it('hides fullscreen action while native fullscreen is active and restores it on exit',()=>{let element:Element|null=null;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>element});render(<Audience projectId="test"/>);expect(screen.getByRole('button',{name:'Fullscreen (F)'})).toBeTruthy();element=document.documentElement;fireEvent(document,new Event('fullscreenchange'));expect(screen.queryByRole('button',{name:'Fullscreen (F)'})).toBeNull();element=null;fireEvent(document,new Event('fullscreenchange'));expect(screen.getByRole('button',{name:'Fullscreen (F)'})).toBeTruthy()});
