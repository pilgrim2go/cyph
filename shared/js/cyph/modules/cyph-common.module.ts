import {CommonModule} from '@angular/common';
import {ErrorHandler, NgModule} from '@angular/core';
import {Title} from '@angular/platform-browser';
import {BlankComponent} from '../components/blank';
import {CalendarInviteComponent} from '../components/calendar-invite';
import {ChatComposeComponent} from '../components/chat-compose';
import {ChatCyphertextComponent} from '../components/chat-cyphertext';
import {ChatCyphertextListComponent} from '../components/chat-cyphertext-list';
import {ChatMainComponent} from '../components/chat-main';
import {ChatMessageBoxComponent} from '../components/chat-message-box';
import {ChatMessageComponent} from '../components/chat-message';
import {ChatMessageListComponent} from '../components/chat-message-list';
import {ContactComponent} from '../components/contact';
import {DynamicFormComponent} from '../components/dynamic-form';
import {FileInputComponent} from '../components/file-input';
import {HelpComponent} from '../components/help';
import {LogoComponent} from '../components/logo';
import {MarkdownComponent} from '../components/markdown';
import {PinInputComponent} from '../components/pin-input';
import {QuillComponent} from '../components/quill';
import {RedirectComponent} from '../components/redirect';
import {SearchBarComponent} from '../components/search-bar';
import {SignupFormComponent} from '../components/signup-form';
import {RouterLinkDirective} from '../directives/router-link.directive';
import {TranslateDirective} from '../directives/translate.directive';
import {AnalyticsService} from '../services/analytics.service';
import {ConfigService} from '../services/config.service';
import {EnvService} from '../services/env.service';
import {ErrorService} from '../services/error.service';
import {FileService} from '../services/file.service';
import {NotificationService} from '../services/notification.service';
import {SignupService} from '../services/signup.service';
import {SplitTestingService} from '../services/split-testing.service';
import {StringsService} from '../services/strings.service';
import {VirtualKeyboardWatcherService} from '../services/virtual-keyboard-watcher.service';
import {WindowWatcherService} from '../services/window-watcher.service';
import {CyphWebModule} from './cyph-web.module';


/**
 * Common module with shared imports for all projects.
 */
@NgModule({
	declarations: [
		BlankComponent,
		CalendarInviteComponent,
		ChatComposeComponent,
		ChatCyphertextComponent,
		ChatCyphertextListComponent,
		ChatMainComponent,
		ChatMessageComponent,
		ChatMessageBoxComponent,
		ChatMessageListComponent,
		ContactComponent,
		DynamicFormComponent,
		FileInputComponent,
		HelpComponent,
		LogoComponent,
		MarkdownComponent,
		PinInputComponent,
		QuillComponent,
		RedirectComponent,
		RouterLinkDirective,
		SearchBarComponent,
		SignupFormComponent,
		TranslateDirective
	],
	entryComponents: [
		ChatMessageComponent,
		HelpComponent
	],
	exports: [
		BlankComponent,
		CalendarInviteComponent,
		ChatComposeComponent,
		ChatCyphertextComponent,
		ChatCyphertextListComponent,
		ChatMainComponent,
		ChatMessageComponent,
		ChatMessageBoxComponent,
		ChatMessageListComponent,
		CommonModule,
		ContactComponent,
		DynamicFormComponent,
		FileInputComponent,
		HelpComponent,
		LogoComponent,
		MarkdownComponent,
		PinInputComponent,
		QuillComponent,
		RedirectComponent,
		RouterLinkDirective,
		SearchBarComponent,
		SignupFormComponent,
		TranslateDirective
	],
	imports: [
		CommonModule,
		CyphWebModule
	],
	providers: [
		AnalyticsService,
		ConfigService,
		EnvService,
		ErrorService,
		FileService,
		NotificationService,
		SignupService,
		SplitTestingService,
		StringsService,
		Title,
		VirtualKeyboardWatcherService,
		WindowWatcherService,
		{
			provide: ErrorHandler,
			useExisting: ErrorService
		}
	]
})
export class CyphCommonModule {
	constructor () {}
}
