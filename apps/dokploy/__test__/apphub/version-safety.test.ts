import {it,expect} from 'vitest';
import {canManageVersions} from '../../../../packages/server/src/services/version-recycle-policy';
it('permits organization admins and the project owner',()=>{expect(canManageVersions('admin','admin','owner')).toBe(true);expect(canManageVersions('developer','owner','owner')).toBe(true);});
it('denies collaborators and unknown owners',()=>{expect(canManageVersions('developer','collaborator','owner')).toBe(false);expect(canManageVersions('developer','collaborator')).toBe(false);});
it('denies readonly users even when they used to own the project',()=>expect(canManageVersions('viewer','owner','owner')).toBe(false));
