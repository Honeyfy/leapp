import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import {TranslateModule} from '@ngx-translate/core';
import {RouterModule} from '@angular/router';
import {SessionLayoutComponent} from './session-layout/session-layout.component';
import {SharedModule} from '../components/shared/shared.module';
import {NoAppbarLayoutComponent} from './noappbar-layout/noappbar-layout.component';
import {TabsModule} from 'ngx-bootstrap/tabs';
import {BsDropdownModule} from 'ngx-bootstrap/dropdown';
import {TooltipModule} from 'ngx-bootstrap/tooltip';


@NgModule({
  declarations: [ SessionLayoutComponent, NoAppbarLayoutComponent ],
  exports: [],
  imports: [
    CommonModule,
    TabsModule.forRoot(),
    TranslateModule,
    BsDropdownModule.forRoot(),
    RouterModule,
    TooltipModule,
    SharedModule
  ]
})
export class LayoutModule { }
