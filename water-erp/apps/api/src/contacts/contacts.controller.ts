import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateContactDto, UpdateContactDto } from './dto/contacts.dto';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @Roles('leader', 'admin', 'staff')
  create(@Body() dto: CreateContactDto, @CurrentUser() user: { sub?: string }) {
    return this.contactsService.create(dto, user);
  }

  @Get()
  @Roles('leader', 'admin', 'staff')
  findMany(@CurrentUser() user: { sub?: string }) {
    return this.contactsService.findMany(user);
  }

  @Get('by-name')
  @Roles('leader', 'admin', 'staff')
  findByName(@Query('name') name: string, @CurrentUser() user: { sub?: string }) {
    return this.contactsService.findByName(name, user);
  }

  @Get(':id')
  @Roles('leader', 'admin', 'staff')
  findOne(@Param('id') id: string, @CurrentUser() user: { sub?: string }) {
    return this.contactsService.findOne(id, user);
  }

  @Put(':id')
  @Roles('leader', 'admin', 'staff')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() user: { sub?: string },
  ) {
    return this.contactsService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('leader', 'admin', 'staff')
  delete(@Param('id') id: string, @CurrentUser() user: { sub?: string }) {
    return this.contactsService.delete(id, user);
  }
}
