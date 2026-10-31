// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,it,expect} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {Dashboard} from './Projects';
import {emptyWorkspace} from '../domain/types';
afterEach(cleanup);
function Harness(){const [workspace,onChange]=useState(emptyWorkspace);return <Dashboard workspace={workspace} onChange={onChange} onOpen={()=>{}} onNew={()=>{}} folderId={null} onFolder={()=>{}}/>}
it('keeps folder validation local and clears it after correction and success',()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'New folder'}));fireEvent.click(screen.getByRole('button',{name:'Create folder'}));expect(screen.getByRole('dialog').textContent).toContain('Enter a folder name.');fireEvent.change(screen.getByLabelText('Folder name'),{target:{value:'Presentations'}});fireEvent.click(screen.getByRole('button',{name:'Create folder'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByText('Enter a folder name.')).toBeNull();expect(screen.getByRole('treeitem').textContent).toContain('Presentations');
});
it('clears abandoned validation before another dialog opens',()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'New folder'}));fireEvent.click(screen.getByRole('button',{name:'Create folder'}));fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('alert')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'New folder'}));expect(screen.queryByRole('alert')).toBeNull();
});
it('returns focus to Browse after Escape and Cancel in the folder picker',async()=>{
 const {ProjectSetup}=await import('./Projects');const {waitFor}=await import('@testing-library/react');
 render(<ProjectSetup workspace={emptyWorkspace()} folderId={null} onCreate={async()=>{}} onCancel={()=>{}}/>);
 const browse=screen.getByRole('button',{name:/No folder.*Browse/});
 for(const action of ['escape','cancel']){browse.focus();fireEvent.click(browse);expect(screen.getByRole('dialog')).not.toBeNull();if(action==='escape')fireEvent.keyDown(document,{key:'Escape'});else fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>{expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(browse)})}
});
